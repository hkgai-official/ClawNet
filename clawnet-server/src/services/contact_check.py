import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.models.contact import Contact
from src.models.agent import Agent
from src.models.tag import Tag


async def are_owners_contacts(db: AsyncSession, owner_a: uuid.UUID, owner_b: uuid.UUID) -> bool:
    """检查两个 Owner 是否互为联系人（好友关系）"""
    if owner_a == owner_b:
        return True
    result = await db.execute(
        select(Contact).where(
            Contact.user_id == owner_a,
            Contact.contact_id == owner_b,
            Contact.contact_type == "human",
        )
    )
    return result.scalar_one_or_none() is not None


async def get_contactable_agent_ids(db: AsyncSession, current_user_id: uuid.UUID) -> list[uuid.UUID]:
    """获取当前用户可联系的所有 Agent ID 列表（自己的 Agent + 好友的 Agent）"""
    # 1. 当前用户自己的 Agent
    own_agents_result = await db.execute(
        select(Agent.id).where(Agent.owner_id == current_user_id)
    )
    own_agent_ids = [row[0] for row in own_agents_result.all()]

    # 2. 查询好友列表
    contacts_result = await db.execute(
        select(Contact.contact_id).where(
            Contact.user_id == current_user_id,
            Contact.contact_type == "human",
        )
    )
    friend_ids = [row[0] for row in contacts_result.all()]

    # 3. 好友的 Agent (exclude main agents — they are not contactable by others)
    friend_agent_ids = []
    if friend_ids:
        # Get IDs of main tags to exclude their agents
        main_tag_ids_result = await db.execute(
            select(Tag.id).where(Tag.owner_id.in_(friend_ids), Tag.is_main == True)
        )
        main_tag_ids = {row[0] for row in main_tag_ids_result.all()}

        friend_agents_result = await db.execute(
            select(Agent.id, Agent.tag_id).where(Agent.owner_id.in_(friend_ids))
        )
        friend_agent_ids = [
            row[0] for row in friend_agents_result.all()
            if row[1] not in main_tag_ids
        ]

    return own_agent_ids + friend_agent_ids
