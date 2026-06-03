"""
Discovery Task API

多用户发现任务的 REST API 端点。
"""

import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.models.user import User
from src.schemas.common import ApiResponse
from src.schemas.discovery_task import (
    DiscoveryTaskResponse,
    DiscoveryTaskListResponse,
    CancelDiscoveryTaskRequest,
    ConfirmDiscoveryTaskRequest,
)
from src.services.discovery_service import discovery_orchestrator

router = APIRouter(prefix="/api/v1/discovery-tasks", tags=["discovery-tasks"])


@router.get("", response_model=ApiResponse[DiscoveryTaskListResponse])
async def list_discovery_tasks(
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """列出当前用户的发现任务"""
    tasks, total = await discovery_orchestrator.list_tasks(
        db, user.id, status, limit, offset
    )
    return ApiResponse(data=DiscoveryTaskListResponse(
        tasks=[DiscoveryTaskResponse.model_validate(t) for t in tasks],
        total=total,
    ))


@router.get("/by-conversation/{conversation_id}", response_model=ApiResponse[Optional[DiscoveryTaskResponse]])
async def get_discovery_task_by_conversation(
    conversation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """根据 conversation_id 查找关联的活跃发现任务"""
    task = await discovery_orchestrator.get_task_by_conversation(db, conversation_id)
    if task and task.initiator_owner_id != user.id:
        return ApiResponse(data=None)
    return ApiResponse(
        data=DiscoveryTaskResponse.model_validate(task) if task else None
    )


@router.get("/{task_id}", response_model=ApiResponse[DiscoveryTaskResponse])
async def get_discovery_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """获取发现任务详情"""
    task = await discovery_orchestrator.get_task(db, task_id, user.id)
    if not task:
        raise ValueError(f"Discovery task {task_id} not found")
    return ApiResponse(data=DiscoveryTaskResponse.model_validate(task))


@router.post("/{task_id}/confirm", response_model=ApiResponse[DiscoveryTaskResponse])
async def confirm_discovery_task(
    task_id: uuid.UUID,
    req: ConfirmDiscoveryTaskRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """确认执行发现任务（可编辑查询计划）"""
    task = await discovery_orchestrator.confirm_task(
        db, task_id, user.id, req.queries
    )
    return ApiResponse(data=DiscoveryTaskResponse.model_validate(task))


@router.post("/{task_id}/cancel", response_model=ApiResponse[DiscoveryTaskResponse])
async def cancel_discovery_task(
    task_id: uuid.UUID,
    req: CancelDiscoveryTaskRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """取消发现任务"""
    task = await discovery_orchestrator.cancel_task(
        db, task_id, user.id, req.reason
    )
    return ApiResponse(data=DiscoveryTaskResponse.model_validate(task))
