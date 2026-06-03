import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.models.user import User
from src.schemas.message import MessageResponse
from src.schemas.user import ContactResponse
from src.schemas.common import ApiResponse
from src.services import search_service

router = APIRouter(prefix="/api/v1/search", tags=["search"])


@router.get("/messages", response_model=ApiResponse[list[MessageResponse]])
async def search_messages(
    q: str = Query(..., min_length=1),
    conversation_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    results = await search_service.search_messages(db, user.id, q, conversation_id)
    return ApiResponse(data=results)


@router.get("/contacts", response_model=ApiResponse[list[ContactResponse]])
async def search_contacts(
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    results = await search_service.search_contacts(db, user.id, q)
    return ApiResponse(data=results)


@router.get("/files", response_model=ApiResponse[list])
async def search_files(
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from src.models.file import File
    from sqlalchemy import select

    result = await db.execute(
        select(File)
        .where(File.name.ilike(f"%{q}%"))
        .order_by(File.created_at.desc())
        .limit(50)
    )
    files = result.scalars().all()

    return ApiResponse(data=[{
        "id": str(f.id),
        "name": f.name,
        "size": f.size,
        "mime_type": f.mime_type,
        "created_at": f.created_at.isoformat(),
    } for f in files])
