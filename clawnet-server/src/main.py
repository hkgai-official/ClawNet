import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from src.config import settings

logger = logging.getLogger("clawnet.main")

from src.database import init_db, close_db
from src.api.auth import router as auth_router
from src.api.users import router as users_router
from src.api.conversations import router as conversations_router
from src.api.messages import router as messages_router
from src.api.agents import router as agents_router
from src.api.tasks import router as tasks_router
from src.api.files import router as files_router
from src.api.search import router as search_router
from src.api.websocket import router as ws_router
from src.api.agent_dialogs import router as agent_dialogs_router
from src.api.discovery import router as discovery_router
from src.api.internal import router as internal_router
from src.api.gateway_proxy import router as gateway_proxy_router
from src.api.tags import router as tags_router
from src.api.audit import router as audit_router
from src.api.admin import router as admin_router
from src.services.openclaw_service import openclaw_service, openclaw_pool, agent_connection_manager
from src.tasks.session_cleanup import session_cleanup_task


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    os.makedirs(os.path.join(settings.UPLOAD_DIR, "files"), exist_ok=True)
    os.makedirs(os.path.join(settings.UPLOAD_DIR, "chunks"), exist_ok=True)
    await init_db()
    # Load gateway user mappings from DB into memory cache
    from src.config import load_gateway_map_from_db
    import sys
    print("[LIFESPAN] About to load gateway map...", file=sys.stderr, flush=True)
    try:
        count = await load_gateway_map_from_db()
        print(f"[LIFESPAN] Gateway map loaded: {count} users", file=sys.stderr, flush=True)
    except Exception as e:
        print(f"[LIFESPAN] Gateway map load FAILED: {e}", file=sys.stderr, flush=True)
    openclaw_service.start()
    session_cleanup_task.start()
    yield
    # Shutdown
    await session_cleanup_task.stop()
    await openclaw_service.stop()
    await close_db()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

# CORS — 禁止 credentials + wildcard origin 组合（浏览器本身也会拒绝）
_cors_origins = settings.CORS_ORIGINS
_allow_credentials = "*" not in _cors_origins
if not _allow_credentials:
    logger.warning(
        "CORS_ORIGINS contains '*' — disabling allow_credentials for safety. "
        "Set explicit origins to enable credentials."
    )
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(conversations_router)
app.include_router(messages_router)
app.include_router(agents_router)
app.include_router(tasks_router)
app.include_router(files_router)
app.include_router(search_router)
app.include_router(ws_router)
app.include_router(agent_dialogs_router)
app.include_router(discovery_router)
app.include_router(internal_router)
app.include_router(gateway_proxy_router)
app.include_router(tags_router)
app.include_router(audit_router)
app.include_router(admin_router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # 仅在 DEBUG 模式下记录详细信息到日志（不泄露到 stdout/客户端）
    if settings.DEBUG:
        logger.debug(
            "Validation error on %s %s: %s",
            request.method, request.url.path, exc.errors(),
        )
    # 向客户端返回字段级错误但不包含请求体内容
    sanitized = [
        {"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")}
        for e in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": sanitized})


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "openclaw_pool": openclaw_pool.get_status(),
        "agent_connections": agent_connection_manager.get_status(),
    }


@app.get("/ready")
async def readiness_check():
    return {"status": "ready"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "src.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )
