import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.models.user import User
from src.schemas.common import ApiResponse
from src.schemas.tag import TagResponse, CreateTagRequest, UpdateTagRequest
from src.services import tag_service
from src.services.openclaw_service import openclaw_pool

router = APIRouter(prefix="/api/v1/tags", tags=["tags"])


@router.post("", response_model=ApiResponse[TagResponse])
async def create_tag(
    req: CreateTagRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    tag = await tag_service.create_tag(db, user.id, req)
    # Best-effort workspace init via gateway
    try:
        conn = await openclaw_pool.get_connection(str(user.id))
        if conn:
            await conn._send_control_request({
                "type": "req",
                "id": f"tag-ws-init-{uuid.uuid4()}",
                "method": "tag.workspace.init",
                "params": {"workspaceId": tag.workspace_id},
            }, timeout=5)
    except Exception:
        pass  # nodeclaw will lazy-init on first conversation

    # Push updated tagFileAccess to gateway
    from src.api.users import _push_permissions_to_gateway
    asyncio.ensure_future(_push_permissions_to_gateway(str(user.id)))

    return ApiResponse(data=tag)


@router.get("", response_model=ApiResponse[list[TagResponse]])
async def list_tags(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    tags = await tag_service.get_tags(db, user.id)
    return ApiResponse(data=tags)


@router.patch("/{tag_id}", response_model=ApiResponse[TagResponse])
async def update_tag(
    tag_id: uuid.UUID,
    req: UpdateTagRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        tag = await tag_service.update_tag(db, tag_id, user.id, req)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Push updated tagFileAccess to gateway
    from src.api.users import _push_permissions_to_gateway
    asyncio.ensure_future(_push_permissions_to_gateway(str(user.id)))

    return ApiResponse(data=tag)


@router.delete("/{tag_id}", response_model=ApiResponse)
async def delete_tag(
    tag_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        await tag_service.delete_tag(db, tag_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Push updated tagFileAccess to gateway (deleted tag key will be absent)
    from src.api.users import _push_permissions_to_gateway
    asyncio.ensure_future(_push_permissions_to_gateway(str(user.id)))

    return ApiResponse(data={"message": "已删除"})
