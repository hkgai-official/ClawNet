import uuid
from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.models.user import User
from src.schemas.conversation import (
    ConversationResponse, CreateConversationRequest, MarkAsReadRequest,
    AddMembersRequest, UpdateConversationRequest, ParticipantInfo,
)
from src.schemas.common import ApiResponse
from src.services import conversation_service

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])


@router.post("", response_model=ApiResponse[ConversationResponse])
async def create_conversation(
    req: CreateConversationRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conv = await conversation_service.create_conversation(db, user, req)
    return ApiResponse(data=conv)


@router.get("", response_model=ApiResponse[list[ConversationResponse]])
async def get_conversations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conversations = await conversation_service.get_conversations(db, user.id)
    return ApiResponse(data=conversations)


@router.get("/{conv_id}", response_model=ApiResponse[ConversationResponse])
async def get_conversation(
    conv_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conv = await conversation_service.get_conversation(db, conv_id, user.id)
    return ApiResponse(data=conv)


@router.patch("/{conv_id}", response_model=ApiResponse[ConversationResponse])
async def update_conversation(
    conv_id: uuid.UUID,
    req: UpdateConversationRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conv = await conversation_service.update_conversation(db, conv_id, user.id, req.title, req.summary, user.display_name)
    return ApiResponse(data=conv)


@router.get("/{conv_id}/members", response_model=ApiResponse[list[ParticipantInfo]])
async def get_members(
    conv_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    members = await conversation_service.get_members(db, conv_id, user.id)
    return ApiResponse(data=members)


@router.post("/{conv_id}/members", response_model=ApiResponse[list[ParticipantInfo]])
async def add_members(
    conv_id: uuid.UUID,
    req: AddMembersRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    added = await conversation_service.add_members(db, conv_id, user.id, req.participant_ids, user.display_name)
    return ApiResponse(data=added)


@router.delete("/{conv_id}/members/{member_id}", response_model=ApiResponse)
async def remove_member(
    conv_id: uuid.UUID,
    member_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await conversation_service.remove_member(db, conv_id, user.id, member_id, user.display_name)
    return ApiResponse(data={"message": "已移除"})


@router.delete("/{conv_id}", response_model=ApiResponse)
async def delete_conversation(
    conv_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await conversation_service.delete_conversation(db, conv_id, user.id)
    return ApiResponse(data={"message": "已删除"})


@router.post("/{conv_id}/read", response_model=ApiResponse)
async def mark_as_read(
    conv_id: uuid.UUID,
    req: Optional[MarkAsReadRequest] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    last_read_id = req.last_read_message_id if req else None
    await conversation_service.mark_as_read(db, conv_id, user.id, last_read_id)
    return ApiResponse(data={"message": "已标记已读"})
