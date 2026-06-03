import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.models.audit import AuditLog
from src.models.user import User
from src.schemas.audit import AuditEventResponse
from src.schemas.common import ApiResponse

router = APIRouter(prefix="/api/v1/audit", tags=["audit"])


@router.get("/events", response_model=ApiResponse)
async def get_audit_events(
    operation_type: Optional[str] = Query(None, description="Filter by operation_type"),
    result: Optional[str] = Query(None, description="Filter by result (denied/success/failed)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get audit events for the current user, newest first."""
    query = select(AuditLog).where(AuditLog.user_id == user.id)

    if operation_type:
        query = query.where(AuditLog.operation_type == operation_type)
    if result:
        query = query.where(AuditLog.result == result)

    query = query.order_by(desc(AuditLog.timestamp)).offset(offset).limit(limit)
    rows = await db.execute(query)
    events = [AuditEventResponse.model_validate(r) for r in rows.scalars().all()]

    return {"status": "success", "data": events}
