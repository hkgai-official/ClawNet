"""
Admin API — 用户管理 + Gateway 容器生命周期。

认证方式: Admin JWT (role=admin 的用户登录后获取)。
危险操作 (stop/delete) 需要二次密码确认。
"""

import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import register_user_gateway, unregister_user_gateway
from src.database import get_db, async_session
from src.dependencies import require_admin
from src.models.user import User
from src.services.provision_service import ProvisionService, make_slug, DEFAULT_GATEWAY_ENV
from src.services import auth_service, tag_service
from src.services.auth_service import allocate_user_code
from src.utils.security import hash_password, verify_password

logger = logging.getLogger("clawnet.admin")

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

provision_svc = ProvisionService()


# ── Schemas ──

class AdminCreateUserRequest(BaseModel):
    email: str
    display_name: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=6, max_length=128)
    env: str = DEFAULT_GATEWAY_ENV


class AdminConfirmRequest(BaseModel):
    admin_password: str = Field(..., min_length=1)


class AdminUserResponse(BaseModel):
    id: uuid.UUID
    display_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    slug: Optional[str] = None
    role: str
    status: str = "offline"
    user_code: Optional[str] = None
    gateway_port: Optional[int] = None
    gateway_env: Optional[str] = None
    gateway_status: Optional[str] = None
    provisioned_at: Optional[datetime] = None
    created_at: datetime
    container_name: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Helpers ──

def _build_container_name(user: User) -> Optional[str]:
    if user.gateway_port and user.slug and user.gateway_env:
        return f"oc-{user.gateway_env}-{user.slug}-{user.gateway_port}"
    return None


def _user_to_response(user: User) -> AdminUserResponse:
    return AdminUserResponse(
        id=user.id,
        display_name=user.display_name,
        email=user.email,
        phone=user.phone,
        slug=user.slug,
        role=user.role,
        status=user.status,
        gateway_port=user.gateway_port,
        gateway_env=user.gateway_env,
        gateway_status=user.gateway_status,
        provisioned_at=user.provisioned_at,
        user_code=user.user_code,
        created_at=user.created_at,
        container_name=_build_container_name(user),
    )


async def _provision_in_background(user_id: str) -> None:
    """Background task to provision a user's gateway container."""
    async with async_session() as db:
        user = await db.get(User, uuid.UUID(user_id))
        if user is None:
            logger.error("Provision background: user %s not found", user_id)
            return
        try:
            await provision_svc.provision(db, user)
            # Update in-memory cache
            register_user_gateway(str(user.id), user.gateway_port, user.gateway_token)
            logger.info("Provision complete for %s (port %d)", user.email, user.gateway_port)
        except Exception:
            logger.exception("Provision background failed for %s", user_id)


# ── Endpoints ──

@router.get("/users")
async def list_users(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """列出所有用户及 gateway 状态"""
    result = await db.execute(
        select(User).order_by(User.created_at.asc())
    )
    users = result.scalars().all()
    return {"data": [_user_to_response(u) for u in users]}


@router.get("/users/{user_id}")
async def get_user(
    user_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """查询单个用户详情"""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    resp = _user_to_response(user)
    # Also include actual Docker container status
    docker_status = provision_svc.get_container_status(user)
    return {"data": {**resp.model_dump(), "docker_status": docker_status}}


@router.post("/users")
async def create_user(
    req: AdminCreateUserRequest,
    background_tasks: BackgroundTasks,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """管理员创建用户并自动 provision"""
    import secrets as _secrets

    # Check email uniqueness
    existing = await db.execute(select(User).where(User.email == req.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Email '{req.email}' already exists")

    # Create user
    slug = make_slug(req.email, req.display_name)
    port = await provision_svc.allocate_port(db, req.env)
    token = _secrets.token_hex(24)
    user_code = await allocate_user_code(db)

    user = User(
        display_name=req.display_name,
        email=req.email,
        password_hash=hash_password(req.password),
        status="offline",
        slug=slug,
        role="user",
        user_code=user_code,
        gateway_port=port,
        gateway_token=token,
        gateway_env=req.env,
        gateway_status="pending",
    )
    db.add(user)
    await db.flush()

    # Create default tag + agent pair
    await tag_service.create_default_tag(db, user.id)
    await db.commit()

    # Async provision
    background_tasks.add_task(_provision_in_background, str(user.id))

    return {
        "data": _user_to_response(user),
        "message": f"User created. Container provisioning started on port {port}.",
    }


@router.post("/users/{user_id}/provision")
async def provision_user(
    user_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """手动触发 provision（error/pending 状态重试）"""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.gateway_status == "provisioning":
        raise HTTPException(status_code=409, detail="Already provisioning")
    if user.gateway_port is None:
        raise HTTPException(status_code=400, detail="User has no gateway port assigned")

    background_tasks.add_task(_provision_in_background, str(user.id))
    return {"data": {"message": "Provision started"}}


@router.post("/users/{user_id}/restart")
async def restart_user(
    user_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """重启用户容器"""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.gateway_port is None:
        raise HTTPException(status_code=400, detail="User has no gateway port assigned")

    await provision_svc.restart(db, user)
    register_user_gateway(str(user.id), user.gateway_port, user.gateway_token)
    return {"data": {"message": "Container restarted", "status": user.gateway_status}}


@router.post("/users/{user_id}/rebuild")
async def rebuild_user(
    user_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """重建用户容器（不动 workspace 数据，只更新容器命令）"""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.gateway_port is None:
        raise HTTPException(status_code=400, detail="User has no gateway port assigned")

    await provision_svc.rebuild(db, user)
    register_user_gateway(str(user.id), user.gateway_port, user.gateway_token)
    return {"data": {"message": "Container rebuilt", "status": user.gateway_status}}


@router.post("/users/rebuild-all")
async def rebuild_all_users(
    background_tasks: BackgroundTasks,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """重建所有用户容器（后台执行）"""
    from src.models.user import User as UserModel
    result = await db.execute(
        select(UserModel).where(UserModel.gateway_port.isnot(None))
    )
    users = result.scalars().all()
    user_ids = [str(u.id) for u in users]

    async def _rebuild_all():
        from src.database import async_session
        for uid in user_ids:
            try:
                async with async_session() as s:
                    u = await s.get(UserModel, uuid.UUID(uid))
                    if u and u.gateway_port:
                        await provision_svc.rebuild(s, u)
                        register_user_gateway(str(u.id), u.gateway_port, u.gateway_token)
            except Exception as e:
                logger.error("Failed to rebuild %s: %s", uid, e)

    background_tasks.add_task(_rebuild_all)
    return {"data": {"message": f"Rebuilding {len(user_ids)} containers in background"}}


@router.post("/users/{user_id}/stop")
async def stop_user(
    user_id: uuid.UUID,
    req: AdminConfirmRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """停止用户容器（需密码确认）"""
    if not verify_password(req.admin_password, admin.password_hash):
        raise HTTPException(status_code=403, detail="Admin password incorrect")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    await provision_svc.stop(db, user)
    unregister_user_gateway(str(user.id))
    return {"data": {"message": "Container stopped"}}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: uuid.UUID,
    req: AdminConfirmRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """删除用户（停容器 + 删 workspace + 删 DB 记录）"""
    if not verify_password(req.admin_password, admin.password_hash):
        raise HTTPException(status_code=403, detail="Admin password incorrect")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if user.role == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete admin user via API")

    # Destroy container + workspace
    if user.gateway_port is not None:
        await provision_svc.destroy(db, user)
    unregister_user_gateway(str(user.id))

    # Delete from DB (cascade deletes agents, tags)
    await db.delete(user)
    await db.commit()

    return {"data": {"message": f"User {user.email} deleted"}}
