import uuid
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from src.models.message import Message
from src.models.conversation import Conversation, ConversationParticipant
from src.models.user import User
from src.models.agent import Agent
from src.schemas.message import SendMessageRequest, MessageResponse, SenderInfo
from src.utils.errors import ConversationNotFound, NotConversationMember, ContentTooLarge


async def send_message(
    db: AsyncSession,
    conv_id: uuid.UUID,
    sender_id: uuid.UUID,
    sender_type: str,
    req: SendMessageRequest,
    skip_unread: bool = False,
) -> MessageResponse:
    # Verify conversation exists
    conv_result = await db.execute(select(Conversation).where(Conversation.id == conv_id))
    conv = conv_result.scalar_one_or_none()
    if not conv:
        raise ConversationNotFound()

    # Verify sender is a participant
    participant_result = await db.execute(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == conv_id,
            ConversationParticipant.participant_id == sender_id,
        )
    )
    if not participant_result.scalar_one_or_none():
        raise NotConversationMember()

    # Create message
    now = datetime.now(timezone.utc)
    msg = Message(
        conversation_id=conv_id,
        sender_id=sender_id,
        sender_type=sender_type,
        content_type=req.content_type,
        content=req.content,
        timestamp=now,
        metadata_=req.metadata,
    )
    db.add(msg)

    # Update conversation
    preview = _extract_preview(req.content_type, req.content)
    conv.last_message_preview = preview
    conv.last_message_at = now
    conv.updated_at = now

    if not skip_unread:
        # Increment unread count for other human participants only
        # (Agent participants don't need unread tracking)
        # 在 A2A 对话中，unread 由前端 addMessage + markAsRead 管理，
        # 后端不递增以避免两个 Owner 都被 +1 导致计数不准。
        other_participants_result = await db.execute(
            select(ConversationParticipant).where(
                ConversationParticipant.conversation_id == conv_id,
                ConversationParticipant.participant_id != sender_id,
                ConversationParticipant.participant_type == "human",
            )
        )
        for p in other_participants_result.scalars().all():
            p.unread_count = (p.unread_count or 0) + 1
            # 新消息到来时，自动重置隐藏状态（让会话重新出现在列表中）
            if p.hidden_at is not None:
                p.hidden_at = None

    await db.flush()

    # Build sender info
    sender_info = await _get_sender_info(db, sender_id, sender_type)

    return MessageResponse(
        id=msg.id,
        conversation_id=msg.conversation_id,
        sender=sender_info,
        content_type=msg.content_type,
        content=msg.content,
        timestamp=msg.timestamp,
        metadata=msg.metadata_,
    )


async def _get_hidden_ids(db: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    from src.models.message import MessageHidden
    hidden_result = await db.execute(
        select(MessageHidden.message_id).where(MessageHidden.user_id == user_id)
    )
    return {row[0] for row in hidden_result.all()}


async def _verify_membership(db: AsyncSession, conv_id: uuid.UUID, user_id: uuid.UUID):
    participant_result = await db.execute(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == conv_id,
            ConversationParticipant.participant_id == user_id,
        )
    )
    if not participant_result.scalar_one_or_none():
        raise NotConversationMember()


async def _build_base_filter(db: AsyncSession, conv_id: uuid.UUID, user_id: uuid.UUID) -> list:
    hidden_ids = await _get_hidden_ids(db, user_id)
    base_filter = [Message.conversation_id == conv_id]
    if hidden_ids:
        base_filter.append(Message.id.notin_(hidden_ids))
    return base_filter


async def _build_responses(db: AsyncSession, messages: list) -> list[MessageResponse]:
    responses = []
    for msg in messages:
        sender_info = await _get_sender_info(db, msg.sender_id, msg.sender_type)
        responses.append(MessageResponse(
            id=msg.id,
            conversation_id=msg.conversation_id,
            sender=sender_info,
            content_type=msg.content_type,
            content=msg.content,
            timestamp=msg.timestamp,
            metadata=msg.metadata_,
        ))
    return responses


async def get_messages(
    db: AsyncSession,
    conv_id: uuid.UUID,
    user_id: uuid.UUID,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[MessageResponse], int]:
    await _verify_membership(db, conv_id, user_id)
    base_filter = await _build_base_filter(db, conv_id, user_id)

    count_result = await db.execute(
        select(func.count()).select_from(Message).where(*base_filter)
    )
    total = count_result.scalar()

    offset = (page - 1) * page_size
    result = await db.execute(
        select(Message)
        .where(*base_filter)
        .order_by(Message.timestamp.desc())
        .offset(offset)
        .limit(page_size)
    )
    messages = result.scalars().all()

    responses = await _build_responses(db, list(reversed(messages)))
    return responses, total


async def get_messages_cursor(
    db: AsyncSession,
    conv_id: uuid.UUID,
    user_id: uuid.UUID,
    after: uuid.UUID | None = None,
    before: uuid.UUID | None = None,
    limit: int = 50,
) -> tuple[list[MessageResponse], bool]:
    """Cursor-based message retrieval.

    - after:  returns messages newer than the given message_id (ascending)
    - before: returns messages older than the given message_id (descending, then reversed)
    Returns (messages_in_chronological_order, has_more).
    """
    await _verify_membership(db, conv_id, user_id)
    base_filter = await _build_base_filter(db, conv_id, user_id)

    if after is not None:
        anchor = await db.get(Message, after)
        if anchor is None:
            return [], False
        base_filter.append(Message.timestamp > anchor.timestamp)
        result = await db.execute(
            select(Message)
            .where(*base_filter)
            .order_by(Message.timestamp.asc())
            .limit(limit + 1)
        )
        rows = result.scalars().all()
        has_more = len(rows) > limit
        messages = rows[:limit]
    elif before is not None:
        anchor = await db.get(Message, before)
        if anchor is None:
            return [], False
        base_filter.append(Message.timestamp < anchor.timestamp)
        result = await db.execute(
            select(Message)
            .where(*base_filter)
            .order_by(Message.timestamp.desc())
            .limit(limit + 1)
        )
        rows = result.scalars().all()
        has_more = len(rows) > limit
        messages = list(reversed(rows[:limit]))
    else:
        return [], False

    responses = await _build_responses(db, messages)
    return responses, has_more


async def delete_message(db: AsyncSession, message_id: uuid.UUID, user_id: uuid.UUID):
    """软删除：仅对当前用户隐藏消息，不影响其他用户。"""
    from src.models.message import MessageHidden
    
    result = await db.execute(select(Message).where(Message.id == message_id))
    msg = result.scalar_one_or_none()
    if not msg:
        from src.utils.errors import NotFoundError
        raise NotFoundError("消息")
    
    # 检查用户是否是该会话的参与者
    participant_result = await db.execute(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == msg.conversation_id,
            ConversationParticipant.participant_id == user_id,
        )
    )
    if not participant_result.scalar_one_or_none():
        from src.utils.errors import ForbiddenError
        raise ForbiddenError("非会话参与者")
    
    # 检查是否已经隐藏
    existing = await db.execute(
        select(MessageHidden).where(
            MessageHidden.message_id == message_id,
            MessageHidden.user_id == user_id,
        )
    )
    if not existing.scalar_one_or_none():
        db.add(MessageHidden(message_id=message_id, user_id=user_id))
        await db.flush()


async def delete_messages_batch(db: AsyncSession, message_ids: list[uuid.UUID], user_id: uuid.UUID):
    """批量软删除：对当前用户隐藏多条消息。"""
    from src.models.message import MessageHidden
    
    if not message_ids:
        return
    
    # 验证所有消息属于用户参与的会话
    for mid in message_ids:
        result = await db.execute(select(Message).where(Message.id == mid))
        msg = result.scalar_one_or_none()
        if not msg:
            continue
        
        participant_result = await db.execute(
            select(ConversationParticipant).where(
                ConversationParticipant.conversation_id == msg.conversation_id,
                ConversationParticipant.participant_id == user_id,
            )
        )
        if not participant_result.scalar_one_or_none():
            continue
        
        # 检查是否已经隐藏
        existing = await db.execute(
            select(MessageHidden).where(
                MessageHidden.message_id == mid,
                MessageHidden.user_id == user_id,
            )
        )
        if not existing.scalar_one_or_none():
            db.add(MessageHidden(message_id=mid, user_id=user_id))
    
    await db.flush()


async def search_messages(
    db: AsyncSession,
    user_id: uuid.UUID,
    query: str,
    conversation_id: uuid.UUID | None = None,
) -> list[MessageResponse]:
    # Get user's conversation IDs
    if conversation_id:
        conv_ids = [conversation_id]
    else:
        result = await db.execute(
            select(ConversationParticipant.conversation_id).where(
                ConversationParticipant.participant_id == user_id
            )
        )
        conv_ids = [row[0] for row in result.all()]

    if not conv_ids:
        return []

    # Simple text search in content JSON
    result = await db.execute(
        select(Message)
        .where(
            Message.conversation_id.in_(conv_ids),
            Message.content.cast(str).ilike(f"%{query}%"),
        )
        .order_by(Message.timestamp.desc())
        .limit(50)
    )
    messages = result.scalars().all()

    responses = []
    for msg in messages:
        sender_info = await _get_sender_info(db, msg.sender_id, msg.sender_type)
        responses.append(MessageResponse(
            id=msg.id,
            conversation_id=msg.conversation_id,
            sender=sender_info,
            content_type=msg.content_type,
            content=msg.content,
            timestamp=msg.timestamp,
            metadata=msg.metadata_,
        ))

    return responses


async def _get_sender_info(db: AsyncSession, sender_id: uuid.UUID, sender_type: str) -> SenderInfo:
    if sender_type == "human":
        result = await db.execute(select(User).where(User.id == sender_id))
        user = result.scalar_one_or_none()
        if user:
            return SenderInfo(id=user.id, name=user.display_name, type="human", avatar=user.avatar_url)
    else:
        result = await db.execute(select(Agent).where(Agent.id == sender_id))
        agent = result.scalar_one_or_none()
        if agent:
            # 获取 Agent 所属用户的名字
            owner_result = await db.execute(select(User).where(User.id == agent.owner_id))
            owner = owner_result.scalar_one_or_none()
            owner_name = owner.display_name if owner else None
            return SenderInfo(
                id=agent.id,
                name=agent.display_name,
                type="agent",
                avatar=agent.avatar_url,
                owner_id=agent.owner_id,
                owner_name=owner_name,
            )

    return SenderInfo(id=sender_id, name="Unknown", type=sender_type, avatar=None)


def _extract_preview(content_type: str, content: dict) -> str:
    if content_type == "text":
        text = content.get("text", "")
        return text[:100] if text else ""
    elif content_type == "image":
        return "[图片]"
    elif content_type == "file":
        return "[文件]"
    elif content_type == "rich_card":
        return "[卡片]"
    elif content_type == "task_request":
        return "[任务请求]"
    elif content_type == "task_progress":
        return "[任务进度]"
    elif content_type == "task_result":
        return "[任务结果]"
    elif content_type == "approval_request":
        return "[审批请求]"
    elif content_type == "system":
        return "[系统消息]"
    return ""
