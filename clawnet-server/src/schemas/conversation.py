from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid


class ParticipantInfo(BaseModel):
    id: uuid.UUID
    name: str
    type: str  # human | agent
    avatar: Optional[str] = None
    owner_id: Optional[uuid.UUID] = None  # Agent 所属用户的 ID
    owner_name: Optional[str] = None  # Agent 所属用户的名字
    role: Optional[str] = None  # owner | admin | member (only for group conversations)

    model_config = {"from_attributes": True}


class ConversationResponse(BaseModel):
    id: uuid.UUID
    type: str
    participants: list[ParticipantInfo] = []
    title: Optional[str] = None
    last_message_preview: Optional[str] = None
    last_message_at: Optional[datetime] = None
    summary: Optional[str] = None
    unread_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CreateConversationRequest(BaseModel):
    type: str  # direct | group | agent_task
    participant_ids: list[uuid.UUID]
    title: Optional[str] = None
    task_context: Optional[dict] = None


class MarkAsReadRequest(BaseModel):
    last_read_message_id: Optional[uuid.UUID] = None


class AddMembersRequest(BaseModel):
    participant_ids: list[uuid.UUID]


class UpdateConversationRequest(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
