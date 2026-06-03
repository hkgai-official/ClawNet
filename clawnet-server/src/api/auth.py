import uuid
import logging
from urllib.parse import urlparse, urlunparse

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import get_gateway_config, register_user_gateway
from src.database import get_db, async_session
from src.dependencies import get_current_user
from src.models.user import User
from src.schemas.auth import RegisterRequest, LoginRequest, RefreshRequest, AuthTokens, ChangePasswordRequest
from src.schemas.user import UserResponse
from src.schemas.common import ApiResponse
from src.services import auth_service
from src.services.provision_service import ProvisionService

_logger = logging.getLogger("clawnet.auth")

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

_provision_svc = ProvisionService()


async def _provision_after_register(user_id: str) -> None:
    """Background task: provision gateway container after user registration."""
    async with async_session() as db:
        user = await db.get(User, uuid.UUID(user_id))
        if user is None:
            return
        try:
            await _provision_svc.provision(db, user)
            register_user_gateway(str(user.id), user.gateway_port, user.gateway_token)
            _logger.info("Auto-provision complete for %s (port %d)", user.email, user.gateway_port)
        except Exception:
            _logger.exception("Auto-provision failed for user %s", user_id)


@router.post("/register", response_model=ApiResponse[dict])
async def register(
    req: RegisterRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    user, tokens = await auth_service.register_user(db, req)
    await db.commit()

    # Trigger async provision
    background_tasks.add_task(_provision_after_register, str(user.id))

    return ApiResponse(data={
        "user": UserResponse.model_validate(user).model_dump(),
        "tokens": tokens.model_dump(),
    })


@router.post("/login", response_model=ApiResponse[dict])
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    user, tokens = await auth_service.login_user(db, req)
    return ApiResponse(data={
        "user": UserResponse.model_validate(user).model_dump(),
        "tokens": tokens.model_dump(),
    })


@router.post("/refresh", response_model=ApiResponse[AuthTokens])
async def refresh(req: RefreshRequest, db: AsyncSession = Depends(get_db)):
    tokens = await auth_service.refresh_tokens(db, req.refresh_token)
    return ApiResponse(data=tokens)


@router.patch("/password", response_model=ApiResponse)
async def change_password(
    req: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await auth_service.change_password(db, user, req.old_password, req.new_password)
    return ApiResponse(data={"message": "密码已修改"})


@router.post("/logout", response_model=ApiResponse)
async def logout(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await auth_service.logout_user(db, user)
    return ApiResponse(data={"message": "已登出"})


@router.post("/gateway-token", response_model=ApiResponse[dict])
async def get_gateway_token(
    request: Request,
    user: User = Depends(get_current_user),
):
    """Return the user's gateway connection credentials for direct WebSocket access."""
    cfg = get_gateway_config(str(user.id))
    if cfg is None:
        raise HTTPException(status_code=404, detail="No gateway configured for this user")

    gateway_url = _rewrite_gateway_url(cfg.ws_url, request)
    return ApiResponse(data={
        "gateway_url": gateway_url,
        "gateway_token": cfg.token,
        "client_id": cfg.client_id,
    })


@router.get("/gateway-health", response_model=ApiResponse[dict])
async def gateway_health(
    user: User = Depends(get_current_user),
):
    """Check whether the user's gateway is reachable."""
    import asyncio
    import websockets

    cfg = get_gateway_config(str(user.id))
    if cfg is None:
        raise HTTPException(status_code=404, detail="No gateway configured for this user")

    try:
        async with asyncio.timeout(5):
            async with websockets.connect(cfg.ws_url):
                pass
        return ApiResponse(data={"status": "ok", "gateway_url": cfg.ws_url})
    except Exception as e:
        return ApiResponse(data={
            "status": "unreachable",
            "gateway_url": cfg.ws_url,
            "error": str(e),
        })


def _rewrite_gateway_url(ws_url: str, request: Request) -> str:
    """Rewrite Docker-internal hostnames so native clients can reach the gateway.

    When the server runs inside Docker, gateway URLs are typically configured
    with ``host.docker.internal``.  Native clients (e.g. a macOS app) cannot
    resolve that hostname, so we replace it with the hostname the client
    actually used to reach *this* server (extracted from the ``Host`` header).

    The client is also expected to align the gateway host with its own server
    URL (see ``AuthManager.alignGatewayHost`` in the macOS app), so this
    rewrite is a best-effort convenience.
    """
    import logging
    logger = logging.getLogger("clawnet.auth")

    parsed = urlparse(ws_url)
    if parsed.hostname != "host.docker.internal":
        logger.info("gateway-token: returning gateway_url=%s (no rewrite needed)", ws_url)
        return ws_url

    # Use the host the client connected to (without port)
    client_host = request.headers.get("host", "localhost")
    # Strip port from Host header (e.g. "localhost:9007" -> "localhost")
    client_host = client_host.split(":")[0] or "localhost"

    # Rebuild the URL with the client-facing host, keeping the original port
    replaced = parsed._replace(netloc=f"{client_host}:{parsed.port}" if parsed.port else client_host)
    rewritten = urlunparse(replaced)
    logger.info(
        "gateway-token: rewrote %s -> %s (client Host: %s)",
        ws_url,
        rewritten,
        request.headers.get("host", "?"),
    )
    return rewritten
