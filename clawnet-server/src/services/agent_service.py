import uuid
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from src.models.agent import Agent
from src.models.user import User
from src.models.task import Task
from src.models.conversation import Conversation, ConversationParticipant
from src.models.contact import Contact
from src.models.tag import Tag
from src.schemas.agent import CreateAgentRequest, UpdateAgentRequest, AgentResponse, AgentAnalytics
from src.utils.errors import AgentNotFound, AgentNotOwner


async def create_agent(
    db: AsyncSession, user: User, req: CreateAgentRequest, *, create_contact: bool = True
) -> AgentResponse:
    # Validate tag_role requires tag_id
    if req.tag_role and not req.tag_id:
        raise ValueError("tag_role requires tag_id to be set")

    # Uniqueness: only one agent per (owner_id, tag_id, tag_role) combination
    if req.tag_id and req.tag_role:
        existing = await db.execute(
            select(Agent).where(
                Agent.owner_id == user.id,
                Agent.tag_id == req.tag_id,
                Agent.tag_role == req.tag_role,
            )
        )
        if existing.scalars().first():
            raise ValueError(
                f"An agent with tag_role='{req.tag_role}' already exists for this tag"
            )

    agent = Agent(
        display_name=req.display_name,
        description=req.description,
        avatar_url=req.avatar_url,
        owner_id=user.id,
        status="online",
        agent_type=req.agent_type,
        capabilities=req.capabilities,
        execution_mode=req.execution_mode,
        interaction_mode=req.interaction_mode,
        model_config_data=req.model_config_data,
        permission_scope=req.permission_scope,
        proactive_rules=req.proactive_rules,
        proactive_intensity=req.proactive_intensity,
        system_prompt=req.system_prompt,
        tag_id=req.tag_id,
        tag_role=req.tag_role,
    )
    db.add(agent)
    await db.flush()

    conv_id = None
    if create_contact:
        # Auto-create a direct conversation with the agent
        conv = Conversation(
            type="direct",
            created_by=user.id,
            title=req.display_name,
        )
        db.add(conv)
        await db.flush()
        conv_id = conv.id

        # Add participants
        db.add(ConversationParticipant(conversation_id=conv.id, participant_id=user.id, participant_type="human"))
        db.add(ConversationParticipant(conversation_id=conv.id, participant_id=agent.id, participant_type="agent"))

        # Auto-add agent as contact
        db.add(Contact(user_id=user.id, contact_id=agent.id, contact_type="agent"))
        await db.flush()

    analytics = await _get_agent_analytics(db, agent.id)

    tag_name = None
    tag_display_name = None
    if agent.tag_id:
        tag_result = await db.execute(select(Tag).where(Tag.id == agent.tag_id))
        tag_obj = tag_result.scalar_one_or_none()
        if tag_obj:
            tag_name = tag_obj.name
            tag_display_name = tag_obj.display_name

    return AgentResponse(
        id=agent.id,
        display_name=agent.display_name,
        description=agent.description,
        avatar_url=agent.avatar_url,
        owner_id=agent.owner_id,
        status=agent.status,
        agent_type=agent.agent_type,
        capabilities=agent.capabilities or [],
        execution_mode=agent.execution_mode,
        interaction_mode=agent.interaction_mode,
        model_config_data=agent.model_config_data,
        permission_scope=agent.permission_scope,
        proactive_rules=agent.proactive_rules or [],
        proactive_intensity=agent.proactive_intensity,
        system_prompt=agent.system_prompt,
        analytics=analytics,
        conversation_id=conv_id,
        tag_id=agent.tag_id,
        tag_name=tag_name,
        tag_display_name=tag_display_name,
        tag_role=agent.tag_role,
        created_at=agent.created_at,
        updated_at=agent.updated_at,
    )


async def get_agents(db: AsyncSession, user_id: uuid.UUID) -> list[AgentResponse]:
    result = await db.execute(
        select(Agent).where(Agent.owner_id == user_id).order_by(Agent.created_at.desc())
    )
    agents = result.scalars().all()

    responses = []
    for agent in agents:
        analytics = await _get_agent_analytics(db, agent.id)
        conv_id = await _get_agent_conversation_id(db, user_id, agent.id)

        tag_name = None
        tag_display_name = None
        if agent.tag_id:
            tag_result = await db.execute(select(Tag).where(Tag.id == agent.tag_id))
            tag_obj = tag_result.scalar_one_or_none()
            if tag_obj:
                tag_name = tag_obj.name
                tag_display_name = tag_obj.display_name

        responses.append(AgentResponse(
            id=agent.id,
            display_name=agent.display_name,
            description=agent.description,
            avatar_url=agent.avatar_url,
            owner_id=agent.owner_id,
            status=agent.status,
            agent_type=agent.agent_type,
            capabilities=agent.capabilities or [],
            execution_mode=agent.execution_mode,
            interaction_mode=agent.interaction_mode,
            model_config_data=agent.model_config_data,
            permission_scope=agent.permission_scope,
            proactive_rules=agent.proactive_rules or [],
            proactive_intensity=agent.proactive_intensity,
            system_prompt=agent.system_prompt,
            analytics=analytics,
            conversation_id=conv_id,
            tag_id=agent.tag_id,
            tag_name=tag_name,
            tag_display_name=tag_display_name,
            tag_role=agent.tag_role,
            created_at=agent.created_at,
            updated_at=agent.updated_at,
        ))

    return responses


async def get_agent(db: AsyncSession, agent_id: uuid.UUID, user_id: uuid.UUID | None = None) -> AgentResponse:
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise AgentNotFound()

    analytics = await _get_agent_analytics(db, agent.id)
    conv_id = None
    if user_id:
        conv_id = await _get_agent_conversation_id(db, user_id, agent.id)

    tag_name = None
    tag_display_name = None
    if agent.tag_id:
        tag_result = await db.execute(select(Tag).where(Tag.id == agent.tag_id))
        tag_obj = tag_result.scalar_one_or_none()
        if tag_obj:
            tag_name = tag_obj.name
            tag_display_name = tag_obj.display_name

    return AgentResponse(
        id=agent.id,
        display_name=agent.display_name,
        description=agent.description,
        avatar_url=agent.avatar_url,
        owner_id=agent.owner_id,
        status=agent.status,
        agent_type=agent.agent_type,
        capabilities=agent.capabilities or [],
        execution_mode=agent.execution_mode,
        interaction_mode=agent.interaction_mode,
        model_config_data=agent.model_config_data,
        permission_scope=agent.permission_scope,
        proactive_rules=agent.proactive_rules or [],
        proactive_intensity=agent.proactive_intensity,
        system_prompt=agent.system_prompt,
        analytics=analytics,
        conversation_id=conv_id,
        tag_id=agent.tag_id,
        tag_name=tag_name,
        tag_display_name=tag_display_name,
        tag_role=agent.tag_role,
        created_at=agent.created_at,
        updated_at=agent.updated_at,
    )


async def update_agent(db: AsyncSession, agent_id: uuid.UUID, user_id: uuid.UUID, req: UpdateAgentRequest) -> AgentResponse:
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise AgentNotFound()
    if agent.owner_id != user_id:
        raise AgentNotOwner()

    updates = req.model_dump(exclude_unset=True)

    # Validate tag_role / tag_id consistency after applying updates
    new_tag_id = updates.get("tag_id", agent.tag_id)
    new_tag_role = updates.get("tag_role", agent.tag_role)
    if new_tag_role and not new_tag_id:
        raise ValueError("tag_role requires tag_id to be set")

    # Uniqueness check when tag_role is being changed
    if new_tag_id and new_tag_role:
        if new_tag_id != agent.tag_id or new_tag_role != agent.tag_role:
            existing = await db.execute(
                select(Agent).where(
                    Agent.owner_id == user_id,
                    Agent.tag_id == new_tag_id,
                    Agent.tag_role == new_tag_role,
                    Agent.id != agent_id,
                )
            )
            if existing.scalars().first():
                raise ValueError(
                    f"An agent with tag_role='{new_tag_role}' already exists for this tag"
                )

    for field, value in updates.items():
        setattr(agent, field, value)

    await db.flush()
    return await get_agent(db, agent_id)


async def delete_agent(db: AsyncSession, agent_id: uuid.UUID, user_id: uuid.UUID):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise AgentNotFound()
    if agent.owner_id != user_id:
        raise AgentNotOwner()
    await db.delete(agent)
    await db.flush()


async def _get_agent_analytics(db: AsyncSession, agent_id: uuid.UUID) -> AgentAnalytics:
    total_result = await db.execute(
        select(func.count()).select_from(Task).where(Task.agent_id == agent_id)
    )
    total = total_result.scalar() or 0

    completed_result = await db.execute(
        select(func.count()).select_from(Task).where(Task.agent_id == agent_id, Task.status == "completed")
    )
    completed = completed_result.scalar() or 0

    failed_result = await db.execute(
        select(func.count()).select_from(Task).where(Task.agent_id == agent_id, Task.status == "failed")
    )
    failed = failed_result.scalar() or 0

    last_task_result = await db.execute(
        select(Task.completed_at).where(Task.agent_id == agent_id).order_by(Task.created_at.desc()).limit(1)
    )
    last_active = last_task_result.scalar_one_or_none()

    return AgentAnalytics(
        total_tasks=total,
        completed_tasks=completed,
        failed_tasks=failed,
        average_response_time=0.0,
        last_active_at=last_active,
    )


async def _get_agent_conversation_id(db: AsyncSession, user_id: uuid.UUID, agent_id: uuid.UUID) -> uuid.UUID | None:
    # Find a direct conversation between user and agent
    result = await db.execute(
        select(ConversationParticipant.conversation_id).where(
            ConversationParticipant.participant_id == agent_id
        )
    )
    agent_conv_ids = [row[0] for row in result.all()]

    if not agent_conv_ids:
        return None

    result = await db.execute(
        select(ConversationParticipant.conversation_id).where(
            ConversationParticipant.conversation_id.in_(agent_conv_ids),
            ConversationParticipant.participant_id == user_id,
        )
    )
    row = result.first()
    return row[0] if row else None
