import uuid
from fastapi import APIRouter, Depends, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.models.user import User
from src.schemas.message import MessageResponse, SendMessageRequest
from src.schemas.common import ApiResponse, PaginatedResponse, PaginationMeta
from src.services import message_service
from src.websocket.manager import ws_manager
from src.services.openclaw_service import openclaw_service
from src.services.session_key_service import upsert_session_key
from src.models.conversation import ConversationParticipant
from src.models.agent import Agent
from sqlalchemy import select

from src.models.message import Message as MessageModel


async def _maybe_trigger_summary(
    db: AsyncSession,
    conv_id: uuid.UUID,
    background_tasks: BackgroundTasks,
) -> None:
    """Check if summary generation should be triggered for this conversation."""
    from src.models.conversation import Conversation
    from sqlalchemy import func

    conv = await db.get(Conversation, conv_id)
    if not conv or conv.type != "direct":
        return

    # Check if conversation has an agent participant
    agent_check = await db.execute(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == conv_id,
            ConversationParticipant.participant_type == "agent",
        )
    )
    if not agent_check.scalar_one_or_none():
        return

    # Count text messages
    count_result = await db.execute(
        select(func.count()).select_from(MessageModel).where(
            MessageModel.conversation_id == conv_id,
            MessageModel.content_type == "text",
        )
    )
    msg_count = count_result.scalar()

    from src.services.summary_service import generate_and_save_summary

    if msg_count >= 2 and conv.summary_version == 0:
        background_tasks.add_task(
            generate_and_save_summary,
            conversation_id=str(conv_id),
            max_messages=2,
            target_version=1,
        )
    elif msg_count in (4, 5, 6) and conv.summary_version == 1:
        background_tasks.add_task(
            generate_and_save_summary,
            conversation_id=str(conv_id),
            max_messages=8,
            target_version=2,
        )


router = APIRouter(prefix="/api/v1", tags=["messages"])


@router.get("/conversations/{conv_id}/messages", response_model=PaginatedResponse[MessageResponse])
async def get_messages(
    conv_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    after: uuid.UUID | None = Query(None, description="返回此消息之后（更新）的消息"),
    before: uuid.UUID | None = Query(None, description="返回此消息之前（更早）的消息"),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if after is not None or before is not None:
        messages, has_more = await message_service.get_messages_cursor(
            db, conv_id, user.id, after=after, before=before, limit=limit,
        )
        newest_id = str(messages[-1].id) if messages else None
        oldest_id = str(messages[0].id) if messages else None
        return PaginatedResponse(
            data=messages,
            meta=PaginationMeta(
                page_size=limit,
                total=len(messages),
                has_more=has_more,
                newest_id=newest_id,
                oldest_id=oldest_id,
            ),
        )

    messages, total = await message_service.get_messages(db, conv_id, user.id, page, page_size)
    newest_id = str(messages[-1].id) if messages else None
    oldest_id = str(messages[0].id) if messages else None
    return PaginatedResponse(
        data=messages,
        meta=PaginationMeta(
            page=page,
            page_size=page_size,
            total=total,
            has_more=(page * page_size) < total,
            newest_id=newest_id,
            oldest_id=oldest_id,
        ),
    )


@router.post("/conversations/{conv_id}/messages", response_model=ApiResponse[MessageResponse])
async def send_message(
    conv_id: uuid.UUID,
    req: SendMessageRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    msg = await message_service.send_message(db, conv_id, user.id, "human", req)

    # Notify via WebSocket (include sender for immediate local echo)
    participant_result = await db.execute(
        select(ConversationParticipant.participant_id).where(
            ConversationParticipant.conversation_id == conv_id
        )
    )
    # Exclude sender from broadcast (they already have the message locally)
    participant_ids = [str(row[0]) for row in participant_result.all() if row[0] != user.id]

    print(f"[API] send_message: participant_ids={participant_ids}, user_id={user.id} (excluded)", flush=True)

    # Serialize sender for WS message (ensure all UUIDs are strings)
    sender_data = msg.sender.model_dump(mode="json")

    print(f"[API] Broadcasting message.new to {participant_ids}", flush=True)
    await ws_manager.broadcast_message(
        participant_ids,
        {
            "type": "message.new",
            "data": {
                "id": str(msg.id),
                "conversation_id": str(conv_id),
                "sender": sender_data,
                "content_type": msg.content_type,
                "content": msg.content,
                "timestamp": msg.timestamp.isoformat(),
                "metadata": msg.metadata,
            },
        },
    )
    print(f"[API] Broadcast done", flush=True)

    # HTTP fallback path should still trigger OpenClaw agent reply.
    # 跳过 agent_task 类型的会话（A2A 对话有独立的 session key 管理）
    from src.models.conversation import Conversation
    conv = await db.get(Conversation, conv_id)
    if req.content_type == "text" and (conv and conv.type != "agent_task"):
        # Find one online agent participant in this conversation.
        result = await db.execute(
            select(ConversationParticipant).where(
                ConversationParticipant.conversation_id == conv_id,
                ConversationParticipant.participant_type == "agent",
            )
        )
        agent_participants = result.scalars().all()
        selected_agent = None
        for ap in agent_participants:
            agent_result = await db.execute(select(Agent).where(Agent.id == ap.participant_id))
            candidate = agent_result.scalar_one_or_none()
            if candidate and candidate.status == "online":
                # Prefer owner-role agent for direct user chat
                if candidate.tag_role == "owner":
                    selected_agent = candidate
                    break
                if selected_agent is None:
                    selected_agent = candidate  # fallback to any online agent

        if selected_agent:
            session_key = f"clawnet:{conv_id}"

            # 持久化 session key 到数据库
            await upsert_session_key(
                db,
                conversation_id=str(conv_id),
                user_id=str(user.id),
                agent_id=str(selected_agent.id),
                session_key=session_key,
            )

            # 连接池会自动为用户创建连接，并处理连接失败的情况
            await openclaw_service.send_chat(
                conversation_id=str(conv_id),
                user_id=str(user.id),
                participant_ids=participant_ids,
                agent_id=str(selected_agent.id),
                session_key=session_key,
                message=req.content.get("text", ""),
                idempotency_key=str(msg.id),
            )

    # Trigger summary generation if applicable
    await _maybe_trigger_summary(db, conv_id, background_tasks)

    return ApiResponse(data=msg)


@router.post("/conversations/{conv_id}/agent-response", response_model=ApiResponse[MessageResponse])
async def save_agent_response(
    conv_id: uuid.UUID,
    req: SendMessageRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Persist an agent response received via direct gateway connection.

    When the web client connects directly to the gateway for LLM streaming,
    it calls this endpoint after receiving the complete response to:
    1. Save the agent message to the database
    2. Extract intents for A2A dialog initiation
    3. Broadcast to other participants via server WebSocket
    """
    import logging
    _logger = logging.getLogger("clawnet.api")

    # Find the agent participant
    result = await db.execute(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == conv_id,
            ConversationParticipant.participant_type == "agent",
        )
    )
    agent_participant = result.scalars().first()
    if not agent_participant:
        from src.utils.errors import AppError
        raise AppError(400, "NO_AGENT", "该会话中没有 Agent 参与者")

    agent_result = await db.execute(select(Agent).where(Agent.id == agent_participant.participant_id))
    agent = agent_result.scalar_one_or_none()
    if not agent:
        from src.utils.errors import AppError
        raise AppError(400, "AGENT_NOT_FOUND", "Agent 不存在")

    # Save as agent message
    msg = await message_service.send_message(
        db, conv_id, agent.id, "agent", req, skip_unread=False
    )

    # Broadcast to other connected clients
    participant_result = await db.execute(
        select(ConversationParticipant.participant_id).where(
            ConversationParticipant.conversation_id == conv_id
        )
    )
    # Exclude the sender (user who submitted this) — they already have it from gateway streaming
    participant_ids = [str(row[0]) for row in participant_result.all() if row[0] != user.id]

    sender_data = msg.sender.model_dump(mode="json")
    await ws_manager.broadcast_message(
        participant_ids,
        {
            "type": "message.new",
            "data": {
                "id": str(msg.id),
                "conversation_id": str(conv_id),
                "sender": sender_data,
                "content_type": msg.content_type,
                "content": msg.content,
                "timestamp": msg.timestamp.isoformat(),
                "metadata": msg.metadata,
            },
        },
    )

    # Intent extraction for A2A dialog initiation
    agent_text = req.content.get("text", "") if isinstance(req.content, dict) else ""
    if agent_text:
        try:
            from src.services.intent_parser import extract_dialog_intents
            cleaned_text, intents = extract_dialog_intents(agent_text)
            if intents:
                _logger.info(
                    "Agent response has %d dialog intent(s) for conv=%s",
                    len(intents), str(conv_id)[:8],
                )
                if len(intents) == 1:
                    # Single intent: initiate A2A dialog directly
                    intent = intents[0]
                    from src.models.user import User as UserModel
                    target_result = await db.execute(
                        select(UserModel).where(UserModel.display_name == intent.target_owner)
                    )
                    target_user = target_result.scalar_one_or_none()
                    if not target_user:
                        target_result = await db.execute(
                            select(UserModel).where(UserModel.display_name.ilike(f'%{intent.target_owner}%'))
                        )
                        target_user = target_result.scalar_one_or_none()

                    if target_user:
                        from src.services import tag_service
                        from src.schemas.agent_dialog import CreateDialogSessionRequest

                        # Resolve MY delegate agent (same tag as the owner agent in this conv)
                        my_delegate = None
                        if agent.tag_id and agent.tag_role == "owner":
                            my_delegate = await tag_service.find_agent_by_tag_role(
                                db, user.id, agent.tag_id, role="delegate"
                            )
                        # Fallback to current agent if no delegate configured
                        initiator = my_delegate if my_delegate else agent

                        # Resolve target's delegate agent (routed by tag)
                        target_tag = await tag_service.resolve_tag_for_contact(
                            db, target_user.id, user.id
                        )
                        target_agent = await tag_service.find_agent_by_tag_role(
                            db, target_user.id, target_tag.id, role="delegate"
                        )
                        if not target_agent:
                            # Fallback: any online agent
                            target_agent_result = await db.execute(
                                select(Agent).where(
                                    Agent.owner_id == target_user.id,
                                    Agent.status == "online",
                                ).limit(1)
                            )
                            target_agent = target_agent_result.scalar_one_or_none()

                        if target_agent:
                            from src.services.agent_dialog_service import agent_dialog_orchestrator
                            dialog_req = CreateDialogSessionRequest(
                                initiator_agent_id=initiator.id,
                                responder_agent_id=target_agent.id,
                                topic=intent.topic,
                            )
                            await agent_dialog_orchestrator.create_session(
                                db=db,
                                req=dialog_req,
                                created_by_user_id=user.id,
                            )
                else:
                    # Multi-intent: create discovery task
                    from src.services.discovery_service import discovery_orchestrator
                    queries = [
                        {"target_owner": i.target_owner, "topic": i.topic}
                        for i in intents
                    ]
                    task = await discovery_orchestrator.create_task(
                        db=db,
                        source_conversation_id=str(conv_id),
                        initiator_agent_id=str(agent.id),
                        initiator_owner_id=str(user.id),
                        original_intent=cleaned_text[:500] or "多目标协作任务",
                        queries=queries,
                    )
                    task.status = "running"
                    task.version += 1
                    await db.flush()
                    await discovery_orchestrator.start_task(str(task.id))

                # Update stored message with cleaned text
                msg.content["text"] = cleaned_text
        except Exception as e:
            _logger.warning("Intent extraction failed: %s", e)

    # Trigger summary generation if applicable
    await _maybe_trigger_summary(db, conv_id, background_tasks)

    return ApiResponse(data=msg)


@router.delete("/messages/{message_id}", response_model=ApiResponse)
async def delete_message(
    message_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await message_service.delete_message(db, message_id, user.id)
    return ApiResponse(data={"message": "已删除"})


from pydantic import BaseModel

class BatchDeleteRequest(BaseModel):
    message_ids: list[uuid.UUID]


@router.post("/messages/batch-delete", response_model=ApiResponse)
async def batch_delete_messages(
    req: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await message_service.delete_messages_batch(db, req.message_ids, user.id)
    return ApiResponse(data={"message": f"已删除 {len(req.message_ids)} 条消息"})
