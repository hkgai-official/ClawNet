import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class NodeAcl(BaseModel):
    allowed_paths: list[str] = []
    denied_paths: list[str] = []


class TagResponse(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    display_name: str
    icon: Optional[str] = None
    color: Optional[str] = None
    is_default: bool
    is_main: bool = False
    workspace_id: str
    node_acl: NodeAcl = NodeAcl()
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CreateTagRequest(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=64)
    icon: Optional[str] = None
    color: Optional[str] = None
    node_acl: NodeAcl = NodeAcl()


class UpdateTagRequest(BaseModel):
    display_name: Optional[str] = Field(None, max_length=64)
    icon: Optional[str] = None
    color: Optional[str] = None
    node_acl: Optional[NodeAcl] = None


class UpdateContactTagRequest(BaseModel):
    tag_id: Optional[uuid.UUID] = None
