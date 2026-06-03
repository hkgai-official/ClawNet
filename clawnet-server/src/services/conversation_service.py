import uuid
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.models.conversation import Conversation, ConversationParticipant
from src.models.user import User
from src.models.agent import Agent
from src.schemas.conversation import (
    CreateConversationRequest,
    ConversationResponse,
    ParticipantInfo,
)
from src.utils.errors import ConversationNotFound, NotConversationMember, ValidationError, ForbiddenError
from src.services.contact_check import are_owners_contacts
from src.websocket.manager import ws_manager


async def _build_participant_info(
    db: AsyncSession, p: ConversationParticipant, is_group: bool = False
) -> ParticipantInfo | None:
    """Build ParticipantInfo from a ConversationParticipant row."""
    role = p.role if is_group else None
    if p.participant_type == "human":
        u = (await db.execute(select(User).where(User.id == p.participant_id))).scalar_one_or_none()
        if u:
            return ParticipantInfo(id=u.id, name=u.display_name, type="human", avatar=u.avatar_url, role=role)
    else:
        a = (await db.execute(select(Agent).where(Agent.id == p.participant_id))).scalar_one_or_none()
        if a:
            owner = (await db.execute(select(User).where(User.id == a.owner_id))).scalar_one_or_none()
            return ParticipantInfo(
                id=a.id, name=a.display_name, type="agent", avatar=a.avatar_url,
                owner_id=a.owner_id,
                owner_name=owner.display_name if owner else None, role=role,
            )
    return None


async def _find_existing_direct(
    db: AsyncSession, user_id: uuid.UUID, other_id: uuid.UUID
) -> ConversationResponse | None:
    """Return existing direct conversation between two participants, or None."""
    # Find conversations where both users are participants and type is direct
    my_convs = select(ConversationParticipant.conversation_id).where(
        ConversationParticipant.participant_id == user_id
    ).subquery()
    other_convs = select(ConversationParticipant.conversation_id).where(
        ConversationParticipant.participant_id == other_id
    ).subquery()

    result = await db.execute(
        select(Conversation)
        .where(
            Conversation.id.in_(select(my_convs.c.conversation_id)),
            Conversation.id.in_(select(other_convs.c.conversation_id)),
            Conversation.type == "direct",
        )
        .options(selectinload(Conversation.participants))
        .order_by(Conversation.created_at.asc())
        .limit(1)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        return None

    # Unhide the conversation for this user if it was hidden
    for p in conv.participants:
        if p.participant_id == user_id and p.hidden_at is not None:
            p.hidden_at = None
            await db.flush()
            break

    # Build response
    participants_info = []
    user_unread = 0
    for p in conv.participants:
        info = await _build_participant_info(db, p)
        if info:
            participants_info.append(info)
        if p.participant_id == user_id:
            user_unread = p.unread_count

    display_title = conv.title
    if len(participants_info) == 2:
        other = next((p for p in participants_info if p.id != user_id), None)
        if other:
            display_title = other.name

    return ConversationResponse(
        id=conv.id,
        type=conv.type,
        participants=participants_info,
        title=display_title,
        summary=conv.summary,
        last_message_preview=conv.last_message_preview,
        last_message_at=conv.last_message_at,
        unread_count=user_unread,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
    )


async def create_conversation(
    db: AsyncSession, user: User, req: CreateConversationRequest
) -> ConversationResponse:
    # For direct conversations, reuse existing one if it already exists
    # BUT allow multiple conversations with the same agent (each gets its own session_key)
    if req.type == "direct" and len(req.participant_ids) == 1:
        other_id = req.participant_ids[0]
        # Check if the target is an agent — agents allow multiple conversations
        agent_result = await db.execute(select(Agent).where(Agent.id == other_id))
        is_agent_target = agent_result.scalar_one_or_none() is not None
        if not is_agent_target:
            existing = await _find_existing_direct(db, user.id, other_id)
            if existing:
                return existing

    # Resolve title: auto-generate for agent conversations if not provided
    title = req.title

    conv = Conversation(
        type=req.type,
        created_by=user.id,
        title=title,
        task_context=req.task_context,
    )
    db.add(conv)
    await db.flush()

    # Add creator as participant (owner for group, member for others)
    creator_role = "owner" if req.type == "group" else "member"
    creator_participant = ConversationParticipant(
        conversation_id=conv.id,
        participant_id=user.id,
        participant_type="human",
        role=creator_role,
    )
    db.add(creator_participant)

    # Add other participants
    is_group = req.type == "group"
    participants_info = [
        ParticipantInfo(id=user.id, name=user.display_name, type="human", avatar=user.avatar_url,
                        role=creator_role if is_group else None)
    ]

    for pid in req.participant_ids:
        if pid == user.id:
            continue

        # Try as user first, then as agent
        user_result = await db.execute(select(User).where(User.id == pid))
        target_user = user_result.scalar_one_or_none()

        if target_user:
            # 校验联系人关系：非当前用户的人类参与者必须是好友
            if not await are_owners_contacts(db, user.id, target_user.id):
                raise ValidationError(f"Cannot add participant: {target_user.display_name} is not in your contacts")

            p = ConversationParticipant(
                conversation_id=conv.id,
                participant_id=pid,
                participant_type="human",
            )
            db.add(p)
            participants_info.append(
                ParticipantInfo(id=target_user.id, name=target_user.display_name, type="human", avatar=target_user.avatar_url,
                                role="member" if is_group else None)
            )
        else:
            agent_result = await db.execute(select(Agent).where(Agent.id == pid))
            target_agent = agent_result.scalar_one_or_none()
            if target_agent:
                # 校验联系人关系：非当前用户拥有的 Agent，其 Owner 必须是好友
                if target_agent.owner_id != user.id:
                    if not await are_owners_contacts(db, user.id, target_agent.owner_id):
                        raise ValidationError(f"Cannot add participant: {target_agent.display_name}'s owner is not in your contacts")

                p = ConversationParticipant(
                    conversation_id=conv.id,
                    participant_id=pid,
                    participant_type="agent",
                )
                db.add(p)
                # Resolve owner name for display
                agent_owner = (await db.execute(select(User).where(User.id == target_agent.owner_id))).scalar_one_or_none()
                participants_info.append(
                    ParticipantInfo(id=target_agent.id, name=target_agent.display_name, type="agent", avatar=target_agent.avatar_url,
                                    owner_id=target_agent.owner_id,
                                    owner_name=agent_owner.display_name if agent_owner else None,
                                    role="member" if is_group else None)
                )

                # Auto-generate title for agent conversations if none provided
                if not title:
                    now_str = datetime.now(timezone.utc).strftime("%m/%d %H:%M")
                    conv.title = f"{target_agent.display_name} · {now_str}"
                    title = conv.title

    await db.flush()

    # For direct conversations, use the other participant's name as display title
    display_title = conv.title
    if req.type == "direct" and not display_title and len(participants_info) == 2:
        other = next((p for p in participants_info if p.id != user.id), None)
        if other:
            display_title = other.name

    return ConversationResponse(
        id=conv.id,
        type=conv.type,
        participants=participants_info,
        title=display_title,
        summary=None,
        last_message_preview=None,
        last_message_at=None,
        unread_count=0,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
    )


async def get_conversations(db: AsyncSession, user_id: uuid.UUID) -> list[ConversationResponse]:
    # Get all conversation IDs the user participates in (exclude hidden)
    result = await db.execute(
        select(ConversationParticipant.conversation_id).where(
            ConversationParticipant.participant_id == user_id,
            ConversationParticipant.hidden_at.is_(None),  # 过滤掉已隐藏的会话
        )
    )
    conv_ids = [row[0] for row in result.all()]

    if not conv_ids:
        return []

    # Load conversations with participants
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id.in_(conv_ids))
        .options(selectinload(Conversation.participants))
        .order_by(Conversation.updated_at.desc())
    )
    conversations = result.scalars().all()

    response_list = []
    for conv in conversations:
        participants_info = []
        user_unread = 0
        is_group = conv.type == "group"

        for p in conv.participants:
            info = await _build_participant_info(db, p, is_group=is_group)
            if info:
                participants_info.append(info)
            if p.participant_id == user_id:
                user_unread = p.unread_count

        # For direct conversations, show the other participant's name as title
        display_title = conv.title
        if conv.type == "direct" and len(participants_info) == 2:
            other_participant = next(
                (p for p in participants_info if p.id != user_id), None
            )
            if other_participant:
                display_title = other_participant.name

        response_list.append(ConversationResponse(
            id=conv.id,
            type=conv.type,
            participants=participants_info,
            title=display_title,
            summary=conv.summary,
            last_message_preview=conv.last_message_preview,
            last_message_at=conv.last_message_at,
            unread_count=user_unread,
            created_at=conv.created_at,
            updated_at=conv.updated_at,
        ))

    return response_list


async def get_conversation(db: AsyncSession, conv_id: uuid.UUID, user_id: uuid.UUID) -> ConversationResponse:
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conv_id)
        .options(selectinload(Conversation.participants))
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise ConversationNotFound()

    # Check membership
    is_member = any(p.participant_id == user_id for p in conv.participants)
    if not is_member:
        raise NotConversationMember()

    participants_info = []
    user_unread = 0
    is_group = conv.type == "group"
    for p in conv.participants:
        info = await _build_participant_info(db, p, is_group=is_group)
        if info:
            participants_info.append(info)
        if p.participant_id == user_id:
            user_unread = p.unread_count

    # For direct conversations, show the other participant's name as title
    display_title = conv.title
    if conv.type == "direct" and len(participants_info) == 2:
        other_participant = next(
            (p for p in participants_info if p.id != user_id), None
        )
        if other_participant:
            display_title = other_participant.name

    return ConversationResponse(
        id=conv.id,
        type=conv.type,
        participants=participants_info,
        title=display_title,
        summary=conv.summary,
        last_message_preview=conv.last_message_preview,
        last_message_at=conv.last_message_at,
        unread_count=user_unread,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
    )


async def delete_conversation(db: AsyncSession, conv_id: uuid.UUID, user_id: uuid.UUID):
    """软删除：仅对当前用户隐藏会话，不影响其他参与者。
    
    设置 hidden_at 标记后，该会话不再出现在用户的会话列表中。
    当会话有新消息到达时，hidden_at 会被自动重置（让会话重新出现）。
    """
    result = await db.execute(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == conv_id,
            ConversationParticipant.participant_id == user_id,
        )
    )
    participant = result.scalar_one_or_none()
    if not participant:
        raise NotConversationMember()
    
    participant.hidden_at = datetime.now(timezone.utc)
    await db.flush()


async def mark_as_read(db: AsyncSession, conv_id: uuid.UUID, user_id: uuid.UUID, last_read_message_id: uuid.UUID | None = None):
    result = await db.execute(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == conv_id,
            ConversationParticipant.participant_id == user_id,
        )
    )
    participant = result.scalar_one_or_none()
    if not participant:
        raise NotConversationMember()

    if last_read_message_id:
        participant.last_read_message_id = last_read_message_id
    participant.unread_count = 0
    await db.flush()


async def _get_participant_role(db: AsyncSession, conv_id: uuid.UUID, user_id: uuid.UUID) -> str | None:
    """Get participant's role in a conversation, or None if not a member."""
    result = await db.execute(
        select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == conv_id,
            ConversationParticipant.participant_id == user_id,
        )
    )
    p = result.scalar_one_or_none()
    return p.role if p else None


async def get_members(db: AsyncSession, conv_id: uuid.UUID, user_id: uuid.UUID) -> list[ParticipantInfo]:
    """Get all members of a conversation with their roles."""
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conv_id)
        .options(selectinload(Conversation.participants))
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise ConversationNotFound()

    is_member = any(p.participant_id == user_id for p in conv.participants)
    if not is_member:
        raise NotConversationMember()

    members = []
    for p in conv.participants:
        info = await _build_participant_info(db, p, is_group=True)
        if info:
            members.append(info)

    # Sort: owner > admin > member, then alphabetically by name
    role_order = {"owner": 0, "admin": 1, "member": 2}
    members.sort(key=lambda m: (role_order.get(m.role or "member", 9), (m.name or "").lower()))
    return members


async def add_members(
    db: AsyncSession, conv_id: uuid.UUID, user_id: uuid.UUID,
    participant_ids: list[uuid.UUID], user_display_name: str,
) -> list[ParticipantInfo]:
    """Add members to a group conversation. Returns info of newly added members."""
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conv_id)
        .options(selectinload(Conversation.participants))
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise ConversationNotFound()
    if conv.type != "group":
        raise ValidationError("只能向群聊添加成员")

    # Check caller's role
    caller_role = None
    existing_ids = set()
    for p in conv.participants:
        existing_ids.add(p.participant_id)
        if p.participant_id == user_id:
            caller_role = p.role

    if caller_role is None:
        raise NotConversationMember()
    if caller_role not in ("owner", "admin"):
        raise ForbiddenError("只有群主或管理员可以添加成员")

    added = []
    added_names = []
    for pid in participant_ids:
        if pid in existing_ids:
            continue

        # Try as user first
        u_result = await db.execute(select(User).where(User.id == pid))
        target_user = u_result.scalar_one_or_none()
        if target_user:
            if not await are_owners_contacts(db, user_id, target_user.id):
                raise ValidationError(f"无法添加 {target_user.display_name}：不是你的联系人")
            p = ConversationParticipant(
                conversation_id=conv_id, participant_id=pid,
                participant_type="human", role="member",
            )
            db.add(p)
            added.append(ParticipantInfo(
                id=target_user.id, name=target_user.display_name,
                type="human", avatar=target_user.avatar_url, role="member",
            ))
            added_names.append(target_user.display_name)
            continue

        # Try as agent
        a_result = await db.execute(select(Agent).where(Agent.id == pid))
        target_agent = a_result.scalar_one_or_none()
        if target_agent:
            if target_agent.owner_id != user_id:
                if not await are_owners_contacts(db, user_id, target_agent.owner_id):
                    raise ValidationError(f"无法添加 {target_agent.display_name}：其所有者不是你的联系人")
            p = ConversationParticipant(
                conversation_id=conv_id, participant_id=pid,
                participant_type="agent", role="member",
            )
            db.add(p)
            added.append(ParticipantInfo(
                id=target_agent.id, name=target_agent.display_name,
                type="agent", avatar=target_agent.avatar_url, role="member",
            ))
            added_names.append(target_agent.display_name)

    if added:
        # Generate system message
        from src.services import message_service
        from src.schemas.message import SendMessageRequest
        names_str = "、".join(added_names)
        sys_text = f"{user_display_name} 邀请 {names_str} 加入了群聊"
        sys_req = SendMessageRequest(
            content_type="system",
            content={"text": sys_text},
        )
        sys_msg = await message_service.send_message(db, conv_id, user_id, "human", sys_req, skip_unread=True)

        await db.flush()

        # Broadcast to all group members via WebSocket
        all_pids = [str(p.participant_id) for p in conv.participants]
        # Also include newly added members (they may not be in conv.participants yet)
        for a in added:
            sid = str(a.id)
            if sid not in all_pids:
                all_pids.append(sid)

        # 1) system message
        await ws_manager.broadcast_message(all_pids, {
            "type": "message.new",
            "data": {
                "id": str(sys_msg.id),
                "conversation_id": str(conv_id),
                "sender": {"id": "system", "name": "系统", "type": "system"},
                "content_type": "system",
                "content": {"text": sys_text},
                "timestamp": sys_msg.timestamp.isoformat(),
            },
        })
        # 2) members changed event
        await ws_manager.broadcast_message(all_pids, {
            "type": "group.members_changed",
            "data": {
                "conversation_id": str(conv_id),
                "action": "added",
                "members": [m.model_dump(mode="json") for m in added],
            },
        })
    else:
        await db.flush()

    return added


async def remove_member(
    db: AsyncSession, conv_id: uuid.UUID, user_id: uuid.UUID,
    target_id: uuid.UUID, user_display_name: str,
):
    """Remove a member from a group, or leave the group if target is self."""
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conv_id)
        .options(selectinload(Conversation.participants))
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise ConversationNotFound()
    if conv.type != "group":
        raise ValidationError("只能从群聊移除成员")

    caller_role = None
    target_participant = None
    target_name = ""
    for p in conv.participants:
        if p.participant_id == user_id:
            caller_role = p.role
        if p.participant_id == target_id:
            target_participant = p

    if caller_role is None:
        raise NotConversationMember()
    if target_participant is None:
        raise ValidationError("该用户不在群中")

    is_self = user_id == target_id

    if is_self:
        # Leaving the group
        if caller_role == "owner":
            raise ValidationError("群主不能退出群聊，请先转让群主")
        # Get display name for system message
        target_name = user_display_name
        sys_text = f"{target_name} 退出了群聊"
    else:
        # Removing someone else
        if caller_role not in ("owner", "admin"):
            raise ForbiddenError("只有群主或管理员可以移除成员")
        if target_participant.role == "owner":
            raise ForbiddenError("不能移除群主")
        if target_participant.role == "admin" and caller_role != "owner":
            raise ForbiddenError("只有群主可以移除管理员")
        # Get target name
        if target_participant.participant_type == "human":
            u = (await db.execute(select(User).where(User.id == target_id))).scalar_one_or_none()
            target_name = u.display_name if u else str(target_id)
        else:
            a = (await db.execute(select(Agent).where(Agent.id == target_id))).scalar_one_or_none()
            target_name = a.display_name if a else str(target_id)
        sys_text = f"{user_display_name} 将 {target_name} 移出了群聊"

    # System message BEFORE delete — sender must still be a member for send_message validation
    from src.services import message_service
    from src.schemas.message import SendMessageRequest
    sys_req = SendMessageRequest(
        content_type="system",
        content={"text": sys_text},
    )
    sys_msg = await message_service.send_message(db, conv_id, user_id, "human", sys_req, skip_unread=True)

    # Collect all participant IDs BEFORE deleting (including the one being removed)
    all_pids = [str(p.participant_id) for p in conv.participants]

    await db.delete(target_participant)
    await db.flush()

    # Broadcast to all members (including the removed one, so their UI updates)
    # 1) system message
    await ws_manager.broadcast_message(all_pids, {
        "type": "message.new",
        "data": {
            "id": str(sys_msg.id),
            "conversation_id": str(conv_id),
            "sender": {"id": "system", "name": "系统", "type": "system"},
            "content_type": "system",
            "content": {"text": sys_text},
            "timestamp": sys_msg.timestamp.isoformat(),
        },
    })
    # 2) members changed event
    await ws_manager.broadcast_message(all_pids, {
        "type": "group.members_changed",
        "data": {
            "conversation_id": str(conv_id),
            "action": "removed",
            "members": [{"id": str(target_id), "name": target_name}],
        },
    })


async def update_conversation(
    db: AsyncSession, conv_id: uuid.UUID, user_id: uuid.UUID,
    title: str | None, summary: str | None, user_display_name: str,
) -> ConversationResponse:
    """Update conversation info. Title changes restricted to groups; summary allowed for all."""
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conv_id)
        .options(selectinload(Conversation.participants))
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise ConversationNotFound()

    # Verify membership
    caller_role = None
    for p in conv.participants:
        if p.participant_id == user_id:
            caller_role = p.role
            break
    if caller_role is None:
        raise NotConversationMember()

    # Title update: group only, owner/admin only
    if title is not None:
        if conv.type != "group":
            raise ValidationError("只能修改群聊标题")
        if caller_role not in ("owner", "admin"):
            raise ForbiddenError("只有群主或管理员可以修改群信息")
        old_title = conv.title
        if title != old_title:
            conv.title = title
            from src.services import message_service
            from src.schemas.message import SendMessageRequest
            sys_req = SendMessageRequest(
                content_type="system",
                content={"text": f'{user_display_name} 修改群名为「{title}」'},
            )
            await message_service.send_message(db, conv_id, user_id, "human", sys_req, skip_unread=True)

    # Summary update: any conversation type, any member
    if summary is not None:
        if len(summary) > 20:
            raise ValidationError("摘要不能超过20个字")
        conv.summary = summary if summary else None
        conv.summary_version = 999  # user-edited, block auto-updates

    await db.flush()
    return await get_conversation(db, conv_id, user_id)
