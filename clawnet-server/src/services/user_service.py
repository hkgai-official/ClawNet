import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from src.models.user import User
from src.models.agent import Agent
from src.models.contact import Contact
from src.models.friend_request import FriendRequest
from src.models.tag import Tag
from src.schemas.user import (
    UserUpdateRequest, ContactResponse, AddContactRequest,
    SendFriendRequestRequest, FriendRequestResponse,
)
from src.utils.errors import NotFoundError, ValidationError


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundError("用户")
    return user


async def update_user(db: AsyncSession, user: User, req: UserUpdateRequest) -> User:
    if req.display_name is not None:
        user.display_name = req.display_name
    if req.avatar_url is not None:
        user.avatar_url = req.avatar_url
    if req.email is not None:
        user.email = req.email
    if req.phone is not None:
        user.phone = req.phone
    if req.settings is not None:
        user.settings = req.settings
    await db.flush()
    return user


async def get_contacts(db: AsyncSession, user_id: uuid.UUID) -> list[ContactResponse]:
    result = await db.execute(
        select(Contact).where(Contact.user_id == user_id)
    )
    contacts = result.scalars().all()

    contact_list = []
    for c in contacts:
        # Look up tag info if tag_id is set
        tag_name = tag_display_name = None
        if c.tag_id:
            tag_result = await db.execute(select(Tag).where(Tag.id == c.tag_id))
            tag_obj = tag_result.scalar_one_or_none()
            if tag_obj:
                tag_name = tag_obj.name
                tag_display_name = tag_obj.display_name

        if c.contact_type == "human":
            user_result = await db.execute(select(User).where(User.id == c.contact_id))
            user = user_result.scalar_one_or_none()
            if user:
                contact_list.append(ContactResponse(
                    id=user.id,
                    display_name=c.nickname or user.display_name,
                    avatar_url=user.avatar_url,
                    email=user.email,
                    type="human",
                    status=user.status,
                    nickname=c.nickname,
                    tag_id=c.tag_id,
                    tag_name=tag_name,
                    tag_display_name=tag_display_name,
                    user_code=user.user_code,
                ))
        elif c.contact_type == "agent":
            agent_result = await db.execute(select(Agent).where(Agent.id == c.contact_id))
            agent = agent_result.scalar_one_or_none()
            if agent:
                contact_list.append(ContactResponse(
                    id=agent.id,
                    display_name=c.nickname or agent.display_name,
                    avatar_url=agent.avatar_url,
                    type="agent",
                    status=agent.status,
                    nickname=c.nickname,
                    tag_id=c.tag_id,
                    tag_name=tag_name,
                    tag_display_name=tag_display_name,
                    user_code=None,
                ))

    return contact_list


async def add_contact(db: AsyncSession, user_id: uuid.UUID, req: AddContactRequest) -> ContactResponse:
    # Verify the contact exists
    if req.contact_type == "human":
        result = await db.execute(select(User).where(User.id == req.contact_id))
        entity = result.scalar_one_or_none()
        if not entity:
            raise NotFoundError("用户")
        display_name = entity.display_name
        avatar_url = entity.avatar_url
        status = entity.status
    elif req.contact_type == "agent":
        result = await db.execute(select(Agent).where(Agent.id == req.contact_id))
        entity = result.scalar_one_or_none()
        if not entity:
            raise NotFoundError("Agent")
        display_name = entity.display_name
        avatar_url = entity.avatar_url
        status = entity.status
    else:
        raise ValidationError("contact_type 必须是 human 或 agent")

    # Check duplicate
    existing = await db.execute(
        select(Contact).where(
            Contact.user_id == user_id,
            Contact.contact_id == req.contact_id,
        )
    )
    if existing.scalar_one_or_none():
        raise ValidationError("联系人已存在")

    contact = Contact(
        user_id=user_id,
        contact_id=req.contact_id,
        contact_type=req.contact_type,
        nickname=req.nickname,
    )
    db.add(contact)
    await db.flush()

    return ContactResponse(
        id=req.contact_id,
        display_name=display_name,
        avatar_url=avatar_url,
        type=req.contact_type,
        status=status,
        nickname=req.nickname,
        user_code=entity.user_code if req.contact_type == "human" else None,
    )


async def delete_contact(db: AsyncSession, user_id: uuid.UUID, contact_id: uuid.UUID):
    result = await db.execute(
        select(Contact).where(
            Contact.user_id == user_id,
            Contact.contact_id == contact_id,
        )
    )
    contact = result.scalar_one_or_none()
    if not contact:
        raise NotFoundError("联系人")
    await db.delete(contact)

    # 同时删除反向好友关系
    reverse_result = await db.execute(
        select(Contact).where(
            Contact.user_id == contact_id,
            Contact.contact_id == user_id,
        )
    )
    reverse_contact = reverse_result.scalar_one_or_none()
    if reverse_contact:
        await db.delete(reverse_contact)

    await db.flush()


# ── 好友请求 ──

async def send_friend_request(
    db: AsyncSession, from_user_id: uuid.UUID, req: SendFriendRequestRequest
) -> FriendRequestResponse:
    if from_user_id == req.to_user_id:
        raise ValidationError("不能添加自己为好友")

    # 检查目标用户是否存在
    to_user = await db.execute(select(User).where(User.id == req.to_user_id))
    to_user = to_user.scalar_one_or_none()
    if not to_user:
        raise NotFoundError("用户")

    # 检查是否已经是好友
    existing_contact = await db.execute(
        select(Contact).where(
            Contact.user_id == from_user_id,
            Contact.contact_id == req.to_user_id,
        )
    )
    if existing_contact.scalar_one_or_none():
        raise ValidationError("对方已经是你的好友")

    # 检查是否已有 pending 请求
    existing_req = await db.execute(
        select(FriendRequest).where(
            FriendRequest.from_user_id == from_user_id,
            FriendRequest.to_user_id == req.to_user_id,
            FriendRequest.status == "pending",
        )
    )
    if existing_req.scalar_one_or_none():
        raise ValidationError("已发送过好友请求，请等待对方处理")

    # 检查对方是否已经向我发送了请求（如果是，直接自动接受）
    reverse_req = await db.execute(
        select(FriendRequest).where(
            FriendRequest.from_user_id == req.to_user_id,
            FriendRequest.to_user_id == from_user_id,
            FriendRequest.status == "pending",
        )
    )
    reverse = reverse_req.scalar_one_or_none()
    if reverse:
        # 自动互相接受
        return await accept_friend_request(db, from_user_id, reverse.id)

    from_user = await db.execute(select(User).where(User.id == from_user_id))
    from_user = from_user.scalar_one_or_none()

    fr = FriendRequest(
        from_user_id=from_user_id,
        to_user_id=req.to_user_id,
        message=req.message,
    )
    db.add(fr)
    await db.flush()

    return FriendRequestResponse(
        id=fr.id,
        from_user_id=from_user_id,
        from_user_name=from_user.display_name,
        from_user_avatar=from_user.avatar_url,
        from_user_code=from_user.user_code,
        to_user_id=to_user.id,
        to_user_name=to_user.display_name,
        to_user_avatar=to_user.avatar_url,
        to_user_code=to_user.user_code,
        status=fr.status,
        message=fr.message,
        created_at=fr.created_at,
    )


async def get_pending_friend_requests(
    db: AsyncSession, user_id: uuid.UUID
) -> list[FriendRequestResponse]:
    """获取我收到的 pending 好友请求"""
    result = await db.execute(
        select(FriendRequest)
        .where(
            FriendRequest.to_user_id == user_id,
            FriendRequest.status == "pending",
        )
        .order_by(FriendRequest.created_at.desc())
    )
    requests = result.scalars().all()

    responses = []
    for fr in requests:
        from_user = await db.execute(select(User).where(User.id == fr.from_user_id))
        from_user = from_user.scalar_one_or_none()
        to_user = await db.execute(select(User).where(User.id == fr.to_user_id))
        to_user = to_user.scalar_one_or_none()
        if from_user and to_user:
            responses.append(FriendRequestResponse(
                id=fr.id,
                from_user_id=fr.from_user_id,
                from_user_name=from_user.display_name,
                from_user_avatar=from_user.avatar_url,
                from_user_code=from_user.user_code,
                to_user_id=fr.to_user_id,
                to_user_name=to_user.display_name,
                to_user_avatar=to_user.avatar_url,
                to_user_code=to_user.user_code,
                status=fr.status,
                message=fr.message,
                created_at=fr.created_at,
            ))
    return responses


async def accept_friend_request(
    db: AsyncSession, user_id: uuid.UUID, request_id: uuid.UUID
) -> FriendRequestResponse:
    result = await db.execute(
        select(FriendRequest).where(
            FriendRequest.id == request_id,
            FriendRequest.to_user_id == user_id,
            FriendRequest.status == "pending",
        )
    )
    fr = result.scalar_one_or_none()
    if not fr:
        raise NotFoundError("好友请求")

    fr.status = "accepted"

    # 双向添加好友
    for (uid, cid) in [(fr.from_user_id, fr.to_user_id), (fr.to_user_id, fr.from_user_id)]:
        existing = await db.execute(
            select(Contact).where(Contact.user_id == uid, Contact.contact_id == cid)
        )
        if not existing.scalar_one_or_none():
            db.add(Contact(user_id=uid, contact_id=cid, contact_type="human"))

    await db.flush()

    from_user = await db.execute(select(User).where(User.id == fr.from_user_id))
    from_user = from_user.scalar_one_or_none()
    to_user = await db.execute(select(User).where(User.id == fr.to_user_id))
    to_user = to_user.scalar_one_or_none()

    return FriendRequestResponse(
        id=fr.id,
        from_user_id=fr.from_user_id,
        from_user_name=from_user.display_name if from_user else "",
        from_user_avatar=from_user.avatar_url if from_user else None,
        from_user_code=from_user.user_code if from_user else None,
        to_user_id=fr.to_user_id,
        to_user_name=to_user.display_name if to_user else "",
        to_user_avatar=to_user.avatar_url if to_user else None,
        to_user_code=to_user.user_code if to_user else None,
        status="accepted",
        message=fr.message,
        created_at=fr.created_at,
    )


async def reject_friend_request(
    db: AsyncSession, user_id: uuid.UUID, request_id: uuid.UUID
) -> FriendRequestResponse:
    result = await db.execute(
        select(FriendRequest).where(
            FriendRequest.id == request_id,
            FriendRequest.to_user_id == user_id,
            FriendRequest.status == "pending",
        )
    )
    fr = result.scalar_one_or_none()
    if not fr:
        raise NotFoundError("好友请求")

    fr.status = "rejected"
    await db.flush()

    from_user = await db.execute(select(User).where(User.id == fr.from_user_id))
    from_user = from_user.scalar_one_or_none()
    to_user = await db.execute(select(User).where(User.id == fr.to_user_id))
    to_user = to_user.scalar_one_or_none()

    return FriendRequestResponse(
        id=fr.id,
        from_user_id=fr.from_user_id,
        from_user_name=from_user.display_name if from_user else "",
        from_user_avatar=from_user.avatar_url if from_user else None,
        from_user_code=from_user.user_code if from_user else None,
        to_user_id=fr.to_user_id,
        to_user_name=to_user.display_name if to_user else "",
        to_user_avatar=to_user.avatar_url if to_user else None,
        to_user_code=to_user.user_code if to_user else None,
        status="rejected",
        message=fr.message,
        created_at=fr.created_at,
    )
