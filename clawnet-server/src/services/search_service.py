import re
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, cast, String, or_

from src.models.message import Message
from src.models.user import User
from src.models.agent import Agent
from src.models.conversation import ConversationParticipant
from src.schemas.message import MessageResponse, SenderInfo
from src.schemas.user import ContactResponse


async def search_messages(
    db: AsyncSession,
    user_id: uuid.UUID,
    query: str,
    conversation_id: uuid.UUID | None = None,
) -> list[MessageResponse]:
    # Get user's conversations
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

    # Search messages containing query text
    result = await db.execute(
        select(Message)
        .where(
            Message.conversation_id.in_(conv_ids),
            cast(Message.content, String).ilike(f"%{query}%"),
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


async def search_contacts(
    db: AsyncSession,
    user_id: uuid.UUID,
    query: str,
) -> list[ContactResponse]:
    # If query is exactly 4 digits, do exact match on user_code
    if re.fullmatch(r'\d{4}', query):
        user_result = await db.execute(
            select(User).where(User.user_code == query).limit(20)
        )
        users = user_result.scalars().all()
        agents = []
    else:
        # Search users by display_name or email
        user_result = await db.execute(
            select(User)
            .where(or_(
                User.display_name.ilike(f"%{query}%"),
                User.email.ilike(f"%{query}%"),
            ))
            .limit(20)
        )
        users = user_result.scalars().all()

        # Search agents owned by user
        agent_result = await db.execute(
            select(Agent)
            .where(
                Agent.owner_id == user_id,
                Agent.display_name.ilike(f"%{query}%"),
            )
            .limit(20)
        )
        agents = agent_result.scalars().all()

    results = []
    for u in users:
        if u.id != user_id:
            results.append(ContactResponse(
                id=u.id,
                display_name=u.display_name,
                avatar_url=u.avatar_url,
                email=u.email,
                type="human",
                status=u.status,
                user_code=u.user_code,
            ))

    for a in agents:
        results.append(ContactResponse(
            id=a.id,
            display_name=a.display_name,
            avatar_url=a.avatar_url,
            type="agent",
            status=a.status,
        ))

    return results


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
            return SenderInfo(id=agent.id, name=agent.display_name, type="agent", avatar=agent.avatar_url)
    return SenderInfo(id=sender_id, name="Unknown", type=sender_type)
