"""
内部 API —— 供外挂程序以 Agent 身份发消息。

认证方式: X-API-Key header（不需要用户密码）。
消息走完整链路：写入数据库 → WebSocket 通知前端 → 用户能看到。

支持两种模式：
1. 普通发送：一次性发送完整消息
2. 流式发送：分批发送消息片段，前端实时显示
"""
import asyncio
import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_db, async_session
from src.models.agent import Agent
from src.models.user import User
from src.models.conversation import ConversationParticipant
from src.schemas.message import SendMessageRequest, MessageResponse
from src.services.message_service import send_message
from src.websocket.manager import ws_manager

router = APIRouter(prefix="/api/internal", tags=["internal"])


def verify_api_key(x_api_key: str = Header(..., alias="X-API-Key")) -> str:
    """验证内部 API Key。"""
    if x_api_key != settings.INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API Key")
    return x_api_key


class AgentSendRequest(BaseModel):
    """Agent 发送消息请求体。"""
    agent_id: uuid.UUID
    conversation_id: uuid.UUID
    content: str
    content_type: str = "text"


@router.post("/agent/send", response_model=dict)
async def agent_send_message(
    req: AgentSendRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(verify_api_key),
):
    """以 Agent 身份向指定会话发送消息。

    消息会写入数据库，并通过 WebSocket 通知前端用户。

    Headers:
        X-API-Key: 内部 API Key

    Body:
        agent_id: Agent ID
        conversation_id: 会话 ID
        content: 消息内容
        content_type: 消息类型 (默认 text)
    """
    # 1. 验证 Agent 存在
    agent_result = await db.execute(
        select(Agent).where(Agent.id == req.agent_id)
    )
    agent = agent_result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent not found: {req.agent_id}")

    # 2. 验证 Agent 是该会话的参与者
    part_result = await db.execute(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == req.conversation_id,
            ConversationParticipant.participant_id == req.agent_id,
            ConversationParticipant.participant_type == "agent",
        )
    )
    if not part_result.scalar_one_or_none():
        raise HTTPException(
            status_code=403,
            detail=f"Agent {req.agent_id} is not a participant of conversation {req.conversation_id}",
        )

    # 3. 构造消息请求并保存
    msg_req = SendMessageRequest(
        content_type=req.content_type,
        content={"text": req.content} if req.content_type == "text" else {"text": req.content},
    )
    msg = await send_message(
        db,
        conv_id=req.conversation_id,
        sender_id=req.agent_id,
        sender_type="agent",
        req=msg_req,
    )

    # 4. 通过 WebSocket 通知所有人类参与者
    participants_result = await db.execute(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == req.conversation_id,
            ConversationParticipant.participant_type == "human",
        )
    )
    human_participant_ids = [
        str(p.participant_id) for p in participants_result.scalars().all()
    ]

    sender_data = msg.sender.model_dump(mode="json")

    await ws_manager.broadcast_message(
        human_participant_ids,
        {
            "type": "message.new",
            "data": {
                "id": str(msg.id),
                "conversation_id": str(req.conversation_id),
                "sender": sender_data,
                "content_type": msg.content_type,
                "content": msg.content,
                "timestamp": msg.timestamp.isoformat(),
                "metadata": msg.metadata,
            },
        },
    )

    return {
        "ok": True,
        "message_id": str(msg.id),
        "conversation_id": str(req.conversation_id),
        "agent_id": str(req.agent_id),
        "agent_name": agent.display_name,
    }


# ============ 流式发送 API ============

class AgentStreamStartRequest(BaseModel):
    """开始流式发送请求体。"""
    agent_id: uuid.UUID
    conversation_id: uuid.UUID


class AgentStreamDeltaRequest(BaseModel):
    """发送流式增量请求体。"""
    stream_id: str  # 由 stream_start 返回
    delta: str  # 增量文本


class AgentStreamEndRequest(BaseModel):
    """结束流式发送请求体。"""
    stream_id: str
    save_to_db: bool = True  # 是否保存到数据库


# 存储活跃的流式会话
_active_streams: dict[str, dict] = {}


@router.post("/agent/stream/start", response_model=dict)
async def agent_stream_start(
    req: AgentStreamStartRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(verify_api_key),
):
    """开始流式发送消息。
    
    返回 stream_id，后续通过 stream_id 发送增量和结束流式。
    
    Headers:
        X-API-Key: 内部 API Key
    
    Body:
        agent_id: Agent ID
        conversation_id: 会话 ID
    """
    # 验证 Agent
    agent = await db.get(Agent, req.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent not found: {req.agent_id}")
    
    # 验证参与者
    part_result = await db.execute(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == req.conversation_id,
            ConversationParticipant.participant_id == req.agent_id,
            ConversationParticipant.participant_type == "agent",
        )
    )
    if not part_result.scalar_one_or_none():
        raise HTTPException(
            status_code=403,
            detail=f"Agent {req.agent_id} is not a participant of conversation {req.conversation_id}",
        )
    
    # 获取 owner 信息
    owner = await db.get(User, agent.owner_id)
    
    # 获取人类参与者
    participants_result = await db.execute(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == req.conversation_id,
            ConversationParticipant.participant_type == "human",
        )
    )
    human_participant_ids = [
        str(p.participant_id) for p in participants_result.scalars().all()
    ]
    
    # 生成 stream_id
    stream_id = f"stream-{uuid.uuid4()}"
    
    # 存储流式会话信息
    _active_streams[stream_id] = {
        "agent_id": str(req.agent_id),
        "conversation_id": str(req.conversation_id),
        "agent_name": agent.display_name,
        "agent_avatar": agent.avatar_url,
        "owner_name": owner.display_name if owner else None,
        "participant_ids": human_participant_ids,
        "buffer": "",
        "started_at": datetime.now(timezone.utc),
    }
    
    # 发送 stream_start 事件
    sender = {
        "id": str(agent.id),
        "name": agent.display_name,
        "type": "agent",
        "avatar": agent.avatar_url,
        "owner_id": str(agent.owner_id),
        "owner_name": owner.display_name if owner else None,
    }
    
    await ws_manager.send_message_stream_start(
        participant_ids=human_participant_ids,
        message_id=stream_id,
        conversation_id=str(req.conversation_id),
        sender=sender,
    )
    
    return {
        "ok": True,
        "stream_id": stream_id,
        "agent_id": str(req.agent_id),
        "conversation_id": str(req.conversation_id),
    }


@router.post("/agent/stream/delta", response_model=dict)
async def agent_stream_delta(
    req: AgentStreamDeltaRequest,
    _: str = Depends(verify_api_key),
):
    """发送流式增量文本。
    
    Headers:
        X-API-Key: 内部 API Key
    
    Body:
        stream_id: 流式会话 ID
        delta: 增量文本
    """
    stream = _active_streams.get(req.stream_id)
    if not stream:
        raise HTTPException(status_code=404, detail=f"Stream not found: {req.stream_id}")
    
    # 累加到 buffer
    stream["buffer"] += req.delta
    
    # 广播增量
    await ws_manager.send_message_stream_delta(
        participant_ids=stream["participant_ids"],
        message_id=req.stream_id,
        conversation_id=stream["conversation_id"],
        delta=req.delta,
        full_text=stream["buffer"],
    )
    
    return {
        "ok": True,
        "stream_id": req.stream_id,
        "buffer_length": len(stream["buffer"]),
    }


@router.post("/agent/stream/end", response_model=dict)
async def agent_stream_end(
    req: AgentStreamEndRequest,
    _: str = Depends(verify_api_key),
):
    """结束流式发送。
    
    可选择是否将完整消息保存到数据库。
    
    Headers:
        X-API-Key: 内部 API Key
    
    Body:
        stream_id: 流式会话 ID
        save_to_db: 是否保存到数据库（默认 True）
    """
    stream = _active_streams.pop(req.stream_id, None)
    if not stream:
        raise HTTPException(status_code=404, detail=f"Stream not found: {req.stream_id}")
    
    final_text = stream["buffer"].strip()
    message_id = None
    
    # 发送 stream_end 事件
    await ws_manager.send_message_stream_end(
        participant_ids=stream["participant_ids"],
        message_id=req.stream_id,
        conversation_id=stream["conversation_id"],
        final_text=final_text,
    )
    
    # 保存到数据库
    if req.save_to_db and final_text:
        async with async_session() as db:
            msg_req = SendMessageRequest(
                content_type="text",
                content={"text": final_text},
                metadata={"source": "internal_stream", "stream_id": req.stream_id},
            )
            msg = await send_message(
                db,
                conv_id=uuid.UUID(stream["conversation_id"]),
                sender_id=uuid.UUID(stream["agent_id"]),
                sender_type="agent",
                req=msg_req,
            )
            await db.commit()
            message_id = str(msg.id)
            
            # 发送 message.new 事件（关联流式消息）
            await ws_manager.broadcast_message(
                stream["participant_ids"],
                {
                    "type": "message.new",
                    "data": {
                        "id": str(msg.id),
                        "conversation_id": stream["conversation_id"],
                        "sender": msg.sender.model_dump(mode="json"),
                        "content_type": msg.content_type,
                        "content": msg.content,
                        "timestamp": msg.timestamp.isoformat(),
                        "metadata": msg.metadata,
                        "streaming_message_id": req.stream_id,
                    },
                },
            )
    
    return {
        "ok": True,
        "stream_id": req.stream_id,
        "message_id": message_id,
        "final_text_length": len(final_text),
        "saved_to_db": req.save_to_db and bool(final_text),
    }


# MARK: - Tag Context

@router.get("/tag-context/{conversation_id}")
async def get_tag_context(
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _api_key: str = Depends(verify_api_key),
):
    """Resolve the tag context (workspace_id, ACL) for a conversation.
    Used by nodeclaw to load the correct workspace at runtime.
    Returns workspace_id (not path) and camelCase node_acl.
    """
    from src.services import tag_service

    context = await tag_service.resolve_conversation_context(db, user_id, conversation_id)
    return context
