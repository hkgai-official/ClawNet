from pydantic import BaseModel, Field, field_validator
from typing import Optional, Literal
from datetime import datetime
import uuid

VALID_TAG_ROLES = ("owner", "delegate")


class AgentAnalytics(BaseModel):
    total_tasks: int = 0
    completed_tasks: int = 0
    failed_tasks: int = 0
    average_response_time: float = 0.0
    last_active_at: Optional[datetime] = None


class AgentResponse(BaseModel):
    id: uuid.UUID
    display_name: str
    description: Optional[str] = None
    avatar_url: Optional[str] = None
    owner_id: uuid.UUID
    status: str
    agent_type: str
    capabilities: list[str] = []
    execution_mode: str
    interaction_mode: str
    model_config_data: Optional[dict] = None
    permission_scope: dict = {}
    proactive_rules: list = []
    proactive_intensity: str = "medium"
    system_prompt: Optional[str] = None
    analytics: AgentAnalytics = AgentAnalytics()
    conversation_id: Optional[uuid.UUID] = None
    tag_id: Optional[uuid.UUID] = None
    tag_name: Optional[str] = None
    tag_display_name: Optional[str] = None
    tag_role: Optional[str] = None
    owner_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CreateAgentRequest(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=64)
    description: Optional[str] = None
    avatar_url: Optional[str] = None
    agent_type: str = "general"
    capabilities: list[str] = []
    execution_mode: str = "hybrid"
    interaction_mode: str = "background"
    model_config_data: Optional[dict] = None
    permission_scope: dict = {}
    proactive_rules: list = []
    proactive_intensity: str = "medium"
    system_prompt: Optional[str] = None
    tag_id: Optional[uuid.UUID] = None
    tag_role: Optional[str] = None  # "owner" or "delegate"

    @field_validator("tag_role")
    @classmethod
    def validate_tag_role(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_TAG_ROLES:
            raise ValueError(f"tag_role must be one of {VALID_TAG_ROLES}")
        return v


class UpdateAgentRequest(BaseModel):
    display_name: Optional[str] = None
    description: Optional[str] = None
    avatar_url: Optional[str] = None
    agent_type: Optional[str] = None
    capabilities: Optional[list[str]] = None
    execution_mode: Optional[str] = None
    interaction_mode: Optional[str] = None
    model_config_data: Optional[dict] = None
    permission_scope: Optional[dict] = None
    proactive_rules: Optional[list] = None
    proactive_intensity: Optional[str] = None
    system_prompt: Optional[str] = None
    tag_id: Optional[uuid.UUID] = None
    tag_role: Optional[str] = None

    @field_validator("tag_role")
    @classmethod
    def validate_tag_role(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_TAG_ROLES:
            raise ValueError(f"tag_role must be one of {VALID_TAG_ROLES}")
        return v
