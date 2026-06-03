import os
import logging
from dataclasses import dataclass
from typing import Optional

from pydantic_settings import BaseSettings

logger = logging.getLogger("clawnet.config")

# ============ 用户/Agent -> OpenClaw Gateway 映射配置 ============

@dataclass
class GatewayConfig:
    """OpenClaw Gateway 连接配置"""
    ws_url: str
    token: str
    client_id: str = "openclaw-control-ui"


# In-memory cache: user_id (str) -> GatewayConfig
# Populated from DB at startup (see src/main.py) and on user registration.
USER_GATEWAY_MAP: dict[str, GatewayConfig] = {}

# Agent -> Gateway 映射 (agent_id -> GatewayConfig)
AGENT_GATEWAY_MAP: dict[str, GatewayConfig] = {}


def get_gateway_config(user_id: str) -> Optional[GatewayConfig]:
    """获取用户对应的 Gateway 配置（从内存缓存读取）"""
    return USER_GATEWAY_MAP.get(user_id)


def has_gateway_config(user_id: str) -> bool:
    """检查用户是否有 Gateway 配置"""
    return user_id in USER_GATEWAY_MAP


def register_user_gateway(user_id: str, port: int, token: str) -> None:
    """注册/更新用户的 Gateway 配置到内存缓存"""
    USER_GATEWAY_MAP[user_id] = GatewayConfig(
        ws_url=f"ws://host.docker.internal:{port}",
        token=token,
    )


def unregister_user_gateway(user_id: str) -> None:
    """从内存缓存移除用户的 Gateway 配置"""
    USER_GATEWAY_MAP.pop(user_id, None)


def get_agent_gateway_config(agent_id: str) -> Optional[GatewayConfig]:
    """获取 Agent 对应的 Gateway 配置"""
    return AGENT_GATEWAY_MAP.get(agent_id)


def register_agent_gateway(agent_id: str, config: GatewayConfig) -> None:
    """注册 Agent 的 Gateway 配置（agent 上线时调用）"""
    AGENT_GATEWAY_MAP[agent_id] = config


def unregister_agent_gateway(agent_id: str) -> None:
    """注销 Agent 的 Gateway 配置（agent 下线时调用）"""
    AGENT_GATEWAY_MAP.pop(agent_id, None)


async def load_gateway_map_from_db() -> int:
    """从数据库加载所有 running 用户的 gateway 配置到内存缓存。

    应在应用启动时调用（见 src/main.py）。
    """
    from src.database import async_session
    from sqlalchemy import select

    try:
        async with async_session() as db:
            # Import here to avoid circular dependency
            from src.models.user import User
            result = await db.execute(
                select(User.id, User.gateway_port, User.gateway_token)
                .where(User.gateway_status == "running")
                .where(User.gateway_port.isnot(None))
                .where(User.gateway_token.isnot(None))
            )
            count = 0
            for row in result.all():
                user_id_str = str(row[0])
                port = row[1]
                token = row[2]
                register_user_gateway(user_id_str, port, token)
                count += 1
            print(f"[STARTUP] Loaded {count} gateway user(s) from database")
            logger.info("Loaded %d gateway user(s) from database", count)
            return count
    except Exception as e:
        print(f"[STARTUP] Failed to load gateway map from database: {e}")
        logger.error("Failed to load gateway map from database: %s", e)
        return 0


# ============ 应用配置 ============

class Settings(BaseSettings):
    # App
    APP_NAME: str = "ClawNet Backend"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 9000
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:9000"]

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://clawnet:clawnet@localhost:5432/clawnet"
    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 10

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # JWT
    JWT_SECRET_KEY: str = "clawnet-secret-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_SECONDS: int = 3600
    JWT_REFRESH_TOKEN_EXPIRE_SECONDS: int = 604800

    # File Upload
    UPLOAD_DIR: str = "./uploads"
    MAX_FILE_SIZE: int = 100 * 1024 * 1024  # 100MB
    CHUNK_SIZE: int = 5 * 1024 * 1024  # 5MB

    # LLM
    ANTHROPIC_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    DEFAULT_LLM_PROVIDER: str = "anthropic"
    DEFAULT_LLM_MODEL: str = "claude-sonnet-4-20250514"

    # WebSocket
    WS_HEARTBEAT_INTERVAL: int = 30
    WS_HEARTBEAT_TIMEOUT: int = 90

    # Streaming Response
    ENABLE_STREAMING_USER_CHAT: bool = True
    ENABLE_STREAMING_AGENT_DIALOG: bool = True
    STREAMING_CHUNK_INTERVAL_MS: int = 50

    # Agent Dialog Settings
    AGENT_DIALOG_DEFAULT_MAX_ROUNDS: int = 10
    AGENT_DIALOG_DEFAULT_IDLE_TIMEOUT: int = 86400
    AGENT_DIALOG_HEARTBEAT_INTERVAL: int = 30
    AGENT_DIALOG_HEARTBEAT_TIMEOUT: int = 10
    AGENT_DIALOG_MAX_RECONNECT_ATTEMPTS: int = 10
    AGENT_DIALOG_RECONNECT_BACKOFF_CAP: int = 30
    AGENT_DIALOG_MESSAGE_BUFFER_SIZE: int = 100
    AGENT_DIALOG_RUN_TIMEOUT_SECONDS: int = 1800

    # Internal API
    INTERNAL_API_KEY: str = "clawnet-internal-key-change-in-production"

    def validate_secrets(self) -> None:
        """Validate that production secrets have been changed from defaults."""
        _WEAK_DEFAULTS = {
            "clawnet-secret-key-change-in-production",
            "clawnet-internal-key-change-in-production",
        }
        if not self.DEBUG:
            if self.JWT_SECRET_KEY in _WEAK_DEFAULTS:
                raise ValueError(
                    "JWT_SECRET_KEY must be changed from default in production. "
                    "Set a strong random value via environment variable."
                )
            if self.INTERNAL_API_KEY in _WEAK_DEFAULTS:
                raise ValueError(
                    "INTERNAL_API_KEY must be changed from default in production. "
                    "Set a strong random value via environment variable."
                )
        else:
            if self.JWT_SECRET_KEY in _WEAK_DEFAULTS:
                logger.warning(
                    "Using default JWT_SECRET_KEY — acceptable for development only"
                )

    # Server External URL (for generating callback URLs, e.g. blob proxy)
    SERVER_EXTERNAL_URL: Optional[str] = None

    # OpenClaw Gateway
    OPENCLAW_CLIENT_ID: str = "openclaw-control-ui"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
settings.validate_secrets()
