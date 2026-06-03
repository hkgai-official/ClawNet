import uuid
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.models.task import Task
from src.models.agent import Agent
from src.schemas.task import CreateTaskRequest, TaskResponse, ApproveTaskRequest
from src.utils.errors import TaskNotFound, AgentNotFound, ForbiddenError


async def create_task(db: AsyncSession, user_id: uuid.UUID, req: CreateTaskRequest) -> TaskResponse:
    # Verify agent exists and user owns it
    agent_result = await db.execute(select(Agent).where(Agent.id == req.agent_id))
    agent = agent_result.scalar_one_or_none()
    if not agent:
        raise AgentNotFound()
    if agent.owner_id != user_id:
        raise ForbiddenError("非Agent所有者")

    task = Task(
        agent_id=req.agent_id,
        conversation_id=req.conversation_id,
        description=req.description,
        status="pending",
        priority=req.priority,
    )
    db.add(task)
    await db.flush()

    return TaskResponse(
        id=task.id,
        agent_id=task.agent_id,
        conversation_id=task.conversation_id,
        description=task.description,
        status=task.status,
        execution_plan=task.execution_plan,
        result=task.result,
        error=task.error,
        priority=task.priority,
        created_at=task.created_at,
        started_at=task.started_at,
        completed_at=task.completed_at,
    )


async def get_task(db: AsyncSession, task_id: uuid.UUID) -> TaskResponse:
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise TaskNotFound()

    return TaskResponse(
        id=task.id,
        agent_id=task.agent_id,
        conversation_id=task.conversation_id,
        description=task.description,
        status=task.status,
        execution_plan=task.execution_plan,
        result=task.result,
        error=task.error,
        priority=task.priority,
        created_at=task.created_at,
        started_at=task.started_at,
        completed_at=task.completed_at,
    )


async def approve_task(db: AsyncSession, task_id: uuid.UUID, user_id: uuid.UUID, req: ApproveTaskRequest) -> TaskResponse:
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise TaskNotFound()

    # Verify user owns the agent
    agent_result = await db.execute(select(Agent).where(Agent.id == task.agent_id))
    agent = agent_result.scalar_one_or_none()
    if not agent or agent.owner_id != user_id:
        raise ForbiddenError("无权审批此任务")

    if req.decision == "approved":
        task.status = "running"
        task.started_at = datetime.now(timezone.utc)
    elif req.decision == "rejected":
        task.status = "cancelled"
        task.completed_at = datetime.now(timezone.utc)
        task.error = f"用户拒绝: {req.modifications or ''}"

    await db.flush()
    return await get_task(db, task_id)


async def cancel_task(db: AsyncSession, task_id: uuid.UUID, user_id: uuid.UUID) -> TaskResponse:
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise TaskNotFound()

    agent_result = await db.execute(select(Agent).where(Agent.id == task.agent_id))
    agent = agent_result.scalar_one_or_none()
    if not agent or agent.owner_id != user_id:
        raise ForbiddenError("无权取消此任务")

    task.status = "cancelled"
    task.completed_at = datetime.now(timezone.utc)
    task.error = "用户取消"
    await db.flush()

    return await get_task(db, task_id)


async def get_task_logs(db: AsyncSession, task_id: uuid.UUID) -> list[dict]:
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise TaskNotFound()

    # Return execution plan steps as logs
    if task.execution_plan and "steps" in task.execution_plan:
        return task.execution_plan["steps"]
    return []
