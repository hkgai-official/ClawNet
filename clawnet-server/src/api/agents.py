import uuid
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.models.agent_session_key import AgentSessionKey
from src.models.user import User
from src.schemas.agent import AgentResponse, CreateAgentRequest, UpdateAgentRequest
from src.schemas.common import ApiResponse
from src.models.agent import Agent
from src.services import agent_service
from src.services.agent_dialog_service import connect_agent_on_online, disconnect_agent_on_offline
from src.services.contact_check import get_contactable_agent_ids

router = APIRouter(prefix="/api/v1/agents", tags=["agents"])


@router.post("", response_model=ApiResponse[AgentResponse])
async def create_agent(
    req: CreateAgentRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    agent = await agent_service.create_agent(db, user, req)
    return ApiResponse(data=agent)


@router.get("", response_model=ApiResponse[list[AgentResponse]])
async def get_agents(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    agents = await agent_service.get_agents(db, user.id)
    return ApiResponse(data=agents)


@router.get("/session-keys", response_model=ApiResponse[list])
async def get_agent_session_keys(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """获取当前用户所有 Agent 的 session key 和 Gateway 连接信息。

    外挂程序也可直接查询 agent_session_keys 表，无需经过此 API。
    """
    result = await db.execute(
        select(AgentSessionKey).where(
            AgentSessionKey.user_id == user.id
        ).order_by(AgentSessionKey.updated_at.desc())
    )
    records = result.scalars().all()

    return ApiResponse(data=[
        {
            "user_id": str(r.user_id),
            "agent_id": str(r.agent_id),
            "session_key": r.session_key,
            "gateway_ws_url": r.gateway_ws_url,
            "gateway_token": r.gateway_token,
            "updated_at": r.updated_at.isoformat(),
        }
        for r in records
    ])


@router.get("/contactable", response_model=ApiResponse[list[AgentResponse]])
async def get_contactable_agents(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """返回当前用户可联系的所有 Agent（自己的 + 好友的）"""
    agent_ids = await get_contactable_agent_ids(db, user.id)
    if not agent_ids:
        return ApiResponse(data=[])

    result = await db.execute(
        select(Agent).where(Agent.id.in_(agent_ids)).order_by(Agent.created_at.desc())
    )
    agents = result.scalars().all()

    responses = []
    for agent in agents:
        # 获取 Owner 名称
        owner = await db.get(User, agent.owner_id)
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
            tag_role=agent.tag_role,
            analytics={"total_tasks": 0, "completed_tasks": 0, "failed_tasks": 0, "average_response_time": 0},
            conversation_id=None,
            created_at=agent.created_at,
            updated_at=agent.updated_at,
            owner_name=owner.display_name if owner else None,
        ))

    return ApiResponse(data=responses)


@router.get("/{agent_id}", response_model=ApiResponse[AgentResponse])
async def get_agent(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    agent = await agent_service.get_agent(db, agent_id, user.id)
    return ApiResponse(data=agent)


@router.patch("/{agent_id}", response_model=ApiResponse[AgentResponse])
async def update_agent(
    agent_id: uuid.UUID,
    req: UpdateAgentRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # 获取更新前的状态
    old_agent = await agent_service.get_agent(db, agent_id, user.id)
    old_status = old_agent.status
    
    # 执行更新
    agent = await agent_service.update_agent(db, agent_id, user.id, req)
    
    # 检查状态变化，处理连接
    if req.status and req.status != old_status:
        if req.status == "online":
            # Agent 上线，建立 Gateway 连接
            await connect_agent_on_online(str(agent_id), str(user.id))
        elif req.status == "offline":
            # Agent 下线，断开 Gateway 连接并清理对话会话
            await disconnect_agent_on_offline(str(agent_id))
    
    return ApiResponse(data=agent)


@router.delete("/{agent_id}", response_model=ApiResponse)
async def delete_agent(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await agent_service.delete_agent(db, agent_id, user.id)
    return ApiResponse(data={"message": "已删除"})


@router.get("/{agent_id}/logs", response_model=ApiResponse[list])
async def get_agent_logs(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    from src.models.audit import AuditLog
    from sqlalchemy import select
    result = await db.execute(
        select(AuditLog)
        .where(AuditLog.agent_id == agent_id)
        .order_by(AuditLog.timestamp.desc())
        .limit(100)
    )
    logs = result.scalars().all()
    return ApiResponse(data=[{
        "id": str(log.id),
        "operation_type": log.operation_type,
        "operation_details": log.operation_details,
        "permission_level": log.permission_level,
        "result": log.result,
        "timestamp": log.timestamp.isoformat(),
    } for log in logs])
