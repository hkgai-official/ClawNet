"""
Agent Dialog API

Agent-to-Agent 对话的 REST API 端点。
"""

import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.models.user import User
from src.schemas.agent_dialog import (
    CreateDialogSessionRequest,
    ApproveDialogSessionRequest,
    TerminateDialogSessionRequest,
    ExtendDialogSessionRequest,
    DialogSessionResponse,
    DialogSessionListResponse,
    RefineRequest,
    SubmitResponseRequest,
)
from src.schemas.common import ApiResponse
from src.services.agent_dialog_service import agent_dialog_orchestrator

router = APIRouter(prefix="/api/v1/agent-dialogs", tags=["agent-dialogs"])


@router.post("", response_model=ApiResponse[DialogSessionResponse])
async def create_dialog_session(
    req: CreateDialogSessionRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """创建 Agent 对话会话
    
    发起方 Owner 调用此接口，系统会：
    1. 创建会话
    2. 自动批准发起方
    3. 向接收方 Owner 发送授权请求
    """
    session = await agent_dialog_orchestrator.create_session(db, req, user.id)
    return ApiResponse(data=session)


@router.get("", response_model=ApiResponse[DialogSessionListResponse])
async def list_dialog_sessions(
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """列出当前用户参与的 Agent 对话会话"""
    sessions, total = await agent_dialog_orchestrator.list_sessions(
        db, user.id, status, limit, offset
    )
    return ApiResponse(data=DialogSessionListResponse(sessions=sessions, total=total))


@router.get("/by-conversation/{conversation_id}", response_model=ApiResponse[Optional[DialogSessionResponse]])
async def get_dialog_session_by_conversation(
    conversation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """根据 conversation_id 查找关联的 Agent 对话会话"""
    session = await agent_dialog_orchestrator.get_session_by_conversation(
        db, conversation_id, user.id
    )
    return ApiResponse(data=session)


@router.get("/{session_id}", response_model=ApiResponse[DialogSessionResponse])
async def get_dialog_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """获取 Agent 对话会话详情"""
    session = await agent_dialog_orchestrator.get_session(db, session_id, user.id)
    return ApiResponse(data=session)


@router.post("/{session_id}/approve", response_model=ApiResponse[DialogSessionResponse])
async def approve_dialog_session(
    session_id: uuid.UUID,
    req: ApproveDialogSessionRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """批准或拒绝 Agent 对话请求
    
    接收方 Owner 调用此接口处理授权请求。
    """
    session = await agent_dialog_orchestrator.approve_session(
        db, session_id, user.id, req.approved, req.reason
    )
    return ApiResponse(data=session)


@router.post("/{session_id}/terminate", response_model=ApiResponse[DialogSessionResponse])
async def terminate_dialog_session(
    session_id: uuid.UUID,
    req: TerminateDialogSessionRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """终止 Agent 对话会话
    
    任一方 Owner 都可以随时终止对话。
    """
    session = await agent_dialog_orchestrator.terminate_session(
        db, session_id, user.id, req.reason
    )
    return ApiResponse(data=session)


@router.post("/{session_id}/extend", response_model=ApiResponse[DialogSessionResponse])
async def extend_dialog_session(
    session_id: uuid.UUID,
    req: ExtendDialogSessionRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """延长 Agent 对话会话的轮数
    
    当对话暂停（达到轮数上限或检测到僵局）时，Owner 可以追加轮数继续对话。
    """
    session = await agent_dialog_orchestrator.extend_session(
        db, session_id, user.id, req.additional_rounds
    )
    return ApiResponse(data=session)


@router.post("/{session_id}/request-main")
async def request_main_draft(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Request Main Assistant to generate an advisory draft."""
    try:
        await agent_dialog_orchestrator.request_main_draft(session_id, str(current_user.id))
        return {"status": "generating", "message": "Main assistant draft requested"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.post("/{session_id}/refine")
async def refine_draft(
    session_id: str,
    req: RefineRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Refine a draft response (tag or main agent)."""
    try:
        await agent_dialog_orchestrator.refine_draft(session_id, str(current_user.id), req.target, req.instruction)
        return {"status": "refining", "target": req.target}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.post("/{session_id}/submit-response")
async def submit_response(
    session_id: str,
    req: SubmitResponseRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit the final reviewed response to the A2A dialog."""
    try:
        await agent_dialog_orchestrator.submit_response(session_id, str(current_user.id), req.text)
        return {"status": "sent", "message": "Response submitted"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.get("/{session_id}/messages")
async def get_dialog_messages(
    session_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    before: Optional[str] = Query(None, description="Message ID to fetch before"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """获取 Agent 对话会话的消息历史
    
    这是一个便捷接口，实际数据存储在 conversations 表中。
    """
    from sqlalchemy import select
    from src.models.message import Message
    from src.models.agent_dialog_session import AgentDialogSession
    
    # 获取会话
    session = await db.get(AgentDialogSession, session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")
    
    if not session.is_participant_owner(user.id):
        raise ValueError("You are not a participant owner of this session")
    
    # 获取消息
    query = select(Message).where(
        Message.conversation_id == session.conversation_id
    )
    
    if before:
        before_msg = await db.get(Message, uuid.UUID(before))
        if before_msg:
            query = query.where(Message.timestamp < before_msg.timestamp)
    
    query = query.order_by(Message.timestamp.desc()).limit(limit)
    
    result = await db.execute(query)
    messages = result.scalars().all()
    
    # 构建响应
    return ApiResponse(data={
        "messages": [
            {
                "id": str(msg.id),
                "conversation_id": str(msg.conversation_id),
                "sender_id": str(msg.sender_id),
                "sender_type": msg.sender_type,
                "content_type": msg.content_type,
                "content": msg.content,
                "timestamp": msg.timestamp.isoformat(),
                "metadata": msg.metadata_,
            }
            for msg in reversed(messages)  # 按时间正序返回
        ],
        "has_more": len(messages) == limit,
    })
