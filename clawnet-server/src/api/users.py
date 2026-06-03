import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.dependencies import get_current_user
from src.models.user import User
from src.models.tag import Tag
from src.schemas.user import (
    UserResponse, UserPublicResponse, UserUpdateRequest,
    ContactResponse, AddContactRequest,
    SendFriendRequestRequest, FriendRequestResponse,
)
from src.schemas.tag import UpdateContactTagRequest
from src.schemas.common import ApiResponse
from src.services import user_service

router = APIRouter(prefix="/api/v1", tags=["users"])


@router.get("/users/me", response_model=ApiResponse[UserResponse])
async def get_me(user: User = Depends(get_current_user)):
    return ApiResponse(data=UserResponse.model_validate(user))


@router.patch("/users/me", response_model=ApiResponse[UserResponse])
async def update_me(
    req: UserUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    updated = await user_service.update_user(db, user, req)
    return ApiResponse(data=UserResponse.model_validate(updated))


@router.get("/users/{user_id}", response_model=ApiResponse[UserPublicResponse])
async def get_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    user = await user_service.get_user_by_id(db, user_id)
    return ApiResponse(data=UserPublicResponse.model_validate(user))


@router.get("/contacts", response_model=ApiResponse[list[ContactResponse]])
async def get_contacts(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    contacts = await user_service.get_contacts(db, user.id)
    return ApiResponse(data=contacts)


@router.post("/contacts", response_model=ApiResponse[ContactResponse])
async def add_contact(
    req: AddContactRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    contact = await user_service.add_contact(db, user.id, req)
    return ApiResponse(data=contact)


@router.delete("/contacts/{contact_id}", response_model=ApiResponse)
async def delete_contact(
    contact_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await user_service.delete_contact(db, user.id, contact_id)
    return ApiResponse(data={"message": "已删除"})


@router.patch("/contacts/{contact_id}", response_model=ApiResponse[ContactResponse])
async def update_contact(
    contact_id: uuid.UUID,
    req: UpdateContactTagRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from src.models.contact import Contact

    result = await db.execute(
        select(Contact).where(
            Contact.user_id == user.id,
            Contact.contact_id == contact_id,
        )
    )
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    # Validate: cannot assign main tag to a contact
    if req.tag_id:
        tag_check = await db.execute(select(Tag).where(Tag.id == req.tag_id))
        tag_to_assign = tag_check.scalar_one_or_none()
        if tag_to_assign and tag_to_assign.is_main:
            raise HTTPException(status_code=400, detail="Cannot assign main tag to contacts")

    contact.tag_id = req.tag_id
    await db.flush()

    # Build ContactResponse
    if contact.contact_type == "human":
        u_result = await db.execute(select(User).where(User.id == contact.contact_id))
        target = u_result.scalar_one_or_none()
        display_name = target.display_name if target else "Unknown"
        avatar_url = target.avatar_url if target else None
        email = target.email if target else None
        status = target.status if target else "offline"
    else:
        from src.models.agent import Agent
        a_result = await db.execute(select(Agent).where(Agent.id == contact.contact_id))
        target = a_result.scalar_one_or_none()
        display_name = target.display_name if target else "Unknown"
        avatar_url = target.avatar_url if target else None
        email = None
        status = target.status if target else "offline"

    tag_name = tag_display_name = None
    if contact.tag_id:
        tag_result = await db.execute(select(Tag).where(Tag.id == contact.tag_id))
        tag_obj = tag_result.scalar_one_or_none()
        if tag_obj:
            tag_name = tag_obj.name
            tag_display_name = tag_obj.display_name

    contact_resp = ContactResponse(
        id=contact.contact_id,
        display_name=display_name,
        avatar_url=avatar_url,
        email=email,
        type=contact.contact_type,
        status=status,
        nickname=contact.nickname,
        tag_id=contact.tag_id,
        tag_name=tag_name,
        tag_display_name=tag_display_name,
        user_code=target.user_code if contact.contact_type == "human" and target else None,
    )
    return ApiResponse(data=contact_resp)


# ── 语言偏好 ──

SUPPORTED_LANGS = {"zh-Hans", "zh-Hant", "en"}


class LanguageUpdate(BaseModel):
    language: str  # "zh-Hans" | "zh-Hant" | "en"


@router.put("/users/me/language", response_model=ApiResponse[dict])
async def update_language(
    req: LanguageUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """更新用户语言偏好"""
    if req.language not in SUPPORTED_LANGS:
        from src.utils.errors import AppError
        raise AppError(400, "INVALID_LANGUAGE", f"Supported: {', '.join(sorted(SUPPORTED_LANGS))}")

    settings = dict(user.settings or {})
    settings["language"] = req.language
    user.settings = settings
    await db.commit()

    return ApiResponse(data={"language": req.language})


# ── 好友请求 ──

@router.post("/friend-requests", response_model=ApiResponse[FriendRequestResponse])
async def send_friend_request(
    req: SendFriendRequestRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await user_service.send_friend_request(db, user.id, req)
    # 通过 WebSocket 通知对方
    from src.websocket.manager import ws_manager
    await ws_manager.send_to_user(str(req.to_user_id), {
        "type": "friend_request.new",
        "data": {
            "id": str(result.id),
            "from_user_id": str(result.from_user_id),
            "from_user_name": result.from_user_name,
            "from_user_avatar": result.from_user_avatar,
            "from_user_code": result.from_user_code,
            "message": result.message,
            "created_at": result.created_at.isoformat(),
        },
    })
    return ApiResponse(data=result)


@router.get("/friend-requests/pending", response_model=ApiResponse[list[FriendRequestResponse]])
async def get_pending_friend_requests(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    results = await user_service.get_pending_friend_requests(db, user.id)
    return ApiResponse(data=results)


@router.post("/friend-requests/{request_id}/accept", response_model=ApiResponse[FriendRequestResponse])
async def accept_friend_request(
    request_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await user_service.accept_friend_request(db, user.id, request_id)
    # 通知发起方：请求已被接受
    from src.websocket.manager import ws_manager
    await ws_manager.send_to_user(str(result.from_user_id), {
        "type": "friend_request.accepted",
        "data": {
            "id": str(result.id),
            "by_user_id": str(user.id),
            "by_user_name": user.display_name,
            "from_user_code": result.from_user_code,
        },
    })
    return ApiResponse(data=result)


@router.post("/friend-requests/{request_id}/reject", response_model=ApiResponse[FriendRequestResponse])
async def reject_friend_request(
    request_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await user_service.reject_friend_request(db, user.id, request_id)
    return ApiResponse(data=result)


# ── 文件访问设置 ──

# 默认拒绝路径（安全敏感，不可通过 UI 移除）
DEFAULT_DENIED_PATHS = [
    "/etc/shadow",
    "/etc/passwd",
    "**/.ssh/id_*",
    "**/.env",
    "**/.env.local",
    "**/.env.production",
]


class FileAccessSettings(BaseModel):
    """文件访问设置"""
    mode: str = "scoped"  # deny | scoped | full
    allowed_paths: list[str] = []  # glob patterns: ~/Documents/**, /tmp/*
    denied_paths: list[str] = []  # additional deny patterns (on top of defaults)


class FileAccessSettingsUpdate(BaseModel):
    mode: str | None = None
    allowed_paths: list[str] | None = None
    denied_paths: list[str] | None = None


@router.get("/file-access/settings", response_model=ApiResponse[dict])
async def get_file_access_settings(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """获取当前用户的文件访问设置"""
    settings = user.settings or {}
    file_access = settings.get("file_access", {})

    return ApiResponse(data={
        "mode": file_access.get("mode", "scoped"),
        "allowed_paths": file_access.get("allowed_paths", []),
        "denied_paths": file_access.get("denied_paths", []),
        "default_denied_paths": DEFAULT_DENIED_PATHS,
    })


@router.put("/file-access/settings", response_model=ApiResponse[dict])
async def update_file_access_settings(
    req: FileAccessSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """更新文件访问设置"""
    settings = dict(user.settings or {})
    file_access = dict(settings.get("file_access", {}))

    if req.mode is not None:
        if req.mode not in ("deny", "scoped", "full"):
            from src.utils.errors import AppError
            raise AppError(400, "INVALID_MODE", "模式必须是 deny、scoped 或 full")
        file_access["mode"] = req.mode

    if req.allowed_paths is not None:
        file_access["allowed_paths"] = req.allowed_paths

    if req.denied_paths is not None:
        file_access["denied_paths"] = req.denied_paths

    settings["file_access"] = file_access
    user.settings = settings
    await db.commit()

    # Push updated file access to gateway for all registered proxy nodes
    import asyncio
    asyncio.ensure_future(_push_permissions_to_gateway(str(user.id)))

    # Sync main tag node_acl to match updated user-level whitelist
    from src.services import tag_service
    await tag_service._sync_main_tag_acl(db, user.id)
    await db.commit()

    return ApiResponse(data={
        "mode": file_access.get("mode", "scoped"),
        "allowed_paths": file_access.get("allowed_paths", []),
        "denied_paths": file_access.get("denied_paths", []),
        "default_denied_paths": DEFAULT_DENIED_PATHS,
    })


async def _push_permissions_to_gateway(user_id: str):
    """Push fileAccess + tagFileAccess to gateway for all user's proxy nodes.

    Always pushes BOTH as a complete snapshot to avoid partial updates in paired.json.
    Called via asyncio.ensure_future — always opens its own DB session.
    """
    import logging
    import time
    logger = logging.getLogger("clawnet.users")
    try:
        from src.services.openclaw_service import openclaw_pool
        conn = await openclaw_pool.get_connection(user_id)
        if not conn or not conn.connected:
            return

        # 1. Query DB for fileAccess + tags (own session, reads committed data)
        from src.database import async_session
        from src.models.user import User
        from src.services import tag_service
        from sqlalchemy import select

        async with async_session() as db:
            result = await db.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if not user:
                return

            file_access_settings = (user.settings or {}).get("file_access", {})
            gateway_file_access = {
                "mode": file_access_settings.get("mode", "scoped"),
                "allowedPaths": file_access_settings.get("allowed_paths", []),
                "deniedPaths": file_access_settings.get("denied_paths", []),
                "updatedAtMs": int(time.time() * 1000),
            }

            # 2. Build tagFileAccess from all user's tags
            tags = await tag_service.get_tags(db, user.id)
            tag_file_access = {}
            for tag in tags:
                tag_file_access[tag.name] = {
                    "allowedPaths": tag.node_acl.allowed_paths,
                    "deniedPaths": tag.node_acl.denied_paths,
                }

        # 3. Re-register each proxy node with full permissions snapshot
        for node_id, info in list(conn._registered_proxy_nodes.items()):
            # Update in-memory dict first (resilience: survives RPC failure)
            info["fileAccess"] = gateway_file_access
            info["tagFileAccess"] = tag_file_access
            try:
                import uuid as _uuid
                req_id = f"proxy-reg-{_uuid.uuid4()}"
                params = {"nodeId": node_id, "commands": info["commands"]}
                if info.get("displayName"):
                    params["displayName"] = info["displayName"]
                if info.get("platform"):
                    params["platform"] = info["platform"]
                if info.get("deviceFamily"):
                    params["deviceFamily"] = info["deviceFamily"]
                params["fileAccess"] = gateway_file_access
                params["tagFileAccess"] = tag_file_access
                request = {"type": "req", "id": req_id, "method": "node.proxy.register", "params": params}
                await conn._send_control_request(request, timeout=8)
                logger.info("Pushed permissions to gateway: node=%s user=%s", node_id, user_id[:8])
            except Exception as e:
                logger.warning("Failed to push permissions for node %s: %s", node_id, e)
    except Exception as e:
        logger.warning("Failed to push permissions to gateway: %s", e)
