from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid


class CreateTaskRequest(BaseModel):
    agent_id: uuid.UUID
    conversation_id: uuid.UUID
    description: str
    attachments: list[str] = []
    priority: str = "normal"
    execution_mode_override: Optional[str] = None


class TaskResponse(BaseModel):
    id: uuid.UUID
    agent_id: uuid.UUID
    conversation_id: uuid.UUID
    description: Optional[str] = None
    status: str
    execution_plan: Optional[dict] = None
    result: Optional[dict] = None
    error: Optional[str] = None
    priority: str = "normal"
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ApproveTaskRequest(BaseModel):
    decision: str  # approved | rejected | modified
    modifications: Optional[str] = None
