from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid


class UserResponse(BaseModel):
    id: uuid.UUID
    display_name: str
    avatar_url: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    status: str
    settings: dict = {}
    created_at: datetime
    updated_at: datetime
    user_code: str

    model_config = {"from_attributes": True}


class UserPublicResponse(BaseModel):
    id: uuid.UUID
    display_name: str
    avatar_url: Optional[str] = None
    status: str
    user_code: Optional[str] = None

    model_config = {"from_attributes": True}


class UserUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    settings: Optional[dict] = None


class ContactResponse(BaseModel):
    id: uuid.UUID
    display_name: str
    avatar_url: Optional[str] = None
    email: Optional[str] = None
    type: str  # human | agent
    status: str
    nickname: Optional[str] = None
    tag_id: Optional[uuid.UUID] = None
    tag_name: Optional[str] = None
    tag_display_name: Optional[str] = None
    user_code: Optional[str] = None

    model_config = {"from_attributes": True}


class AddContactRequest(BaseModel):
    contact_id: uuid.UUID
    contact_type: str  # human | agent
    nickname: Optional[str] = None


# ── 好友请求 ──

class SendFriendRequestRequest(BaseModel):
    to_user_id: uuid.UUID
    message: Optional[str] = None


class FriendRequestResponse(BaseModel):
    id: uuid.UUID
    from_user_id: uuid.UUID
    from_user_name: str
    from_user_avatar: Optional[str] = None
    to_user_id: uuid.UUID
    to_user_name: str
    to_user_avatar: Optional[str] = None
    status: str  # pending | accepted | rejected
    message: Optional[str] = None
    created_at: datetime
    from_user_code: Optional[str] = None
    to_user_code: Optional[str] = None
