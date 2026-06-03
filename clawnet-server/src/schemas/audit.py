from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid


class AuditEventResponse(BaseModel):
    id: uuid.UUID
    agent_id: Optional[uuid.UUID] = None
    user_id: Optional[uuid.UUID] = None
    operation_type: str
    operation_details: Optional[dict] = None
    result: str
    timestamp: datetime

    model_config = {"from_attributes": True}
