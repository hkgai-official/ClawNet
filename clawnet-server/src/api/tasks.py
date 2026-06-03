import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.models.user import User
from src.schemas.task import TaskResponse, CreateTaskRequest, ApproveTaskRequest
from src.schemas.common import ApiResponse
from src.services import task_service

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])


@router.post("", response_model=ApiResponse[TaskResponse])
async def create_task(
    req: CreateTaskRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = await task_service.create_task(db, user.id, req)
    return ApiResponse(data=task)


@router.get("/{task_id}", response_model=ApiResponse[TaskResponse])
async def get_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    task = await task_service.get_task(db, task_id)
    return ApiResponse(data=task)


@router.post("/{task_id}/approve", response_model=ApiResponse[TaskResponse])
async def approve_task(
    task_id: uuid.UUID,
    req: ApproveTaskRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = await task_service.approve_task(db, task_id, user.id, req)
    return ApiResponse(data=task)


@router.post("/{task_id}/cancel", response_model=ApiResponse[TaskResponse])
async def cancel_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = await task_service.cancel_task(db, task_id, user.id)
    return ApiResponse(data=task)


@router.get("/{task_id}/logs", response_model=ApiResponse[list])
async def get_task_logs(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    logs = await task_service.get_task_logs(db, task_id)
    return ApiResponse(data=logs)
