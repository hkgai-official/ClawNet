import json
from typing import Literal, Optional
from datetime import datetime

import uuid
from pydantic import BaseModel, field_validator

# 允许的 content_type 白名单
ALLOWED_CONTENT_TYPES = (
    "text", "file", "image", "video", "voice",
    "rich_card", "task_request", "task_progress", "task_result",
    "approval_request", "dialog_request", "dialog_approval",
    "dialog_status", "system",
)

# 序列化后的最大消息体大小 (64 KB)
MAX_CONTENT_SIZE = 64 * 1024


class SenderInfo(BaseModel):
    id: uuid.UUID
    name: str
    type: str  # human | agent
    avatar: Optional[str] = None
    owner_id: Optional[uuid.UUID] = None  # Agent 所属用户的 ID
    owner_name: Optional[str] = None  # Agent 所属用户的名字


class MessageResponse(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    sender: SenderInfo
    content_type: str
    content: dict
    timestamp: datetime
    metadata: Optional[dict] = None

    model_config = {"from_attributes": True}


class SendMessageRequest(BaseModel):
    content_type: str = "text"
    content: dict  # {"text": "..."} or {"file_id": "..."} etc.
    metadata: Optional[dict] = None

    @field_validator("content_type")
    @classmethod
    def validate_content_type(cls, v: str) -> str:
        if v not in ALLOWED_CONTENT_TYPES:
            raise ValueError(f"content_type must be one of {ALLOWED_CONTENT_TYPES}")
        return v

    @field_validator("content")
    @classmethod
    def validate_content_size(cls, v: dict) -> dict:
        size = len(json.dumps(v, ensure_ascii=False))
        if size > MAX_CONTENT_SIZE:
            raise ValueError(
                f"content too large ({size} bytes, max {MAX_CONTENT_SIZE})"
            )
        return v
