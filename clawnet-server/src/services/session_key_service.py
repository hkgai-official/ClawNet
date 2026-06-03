"""
Agent Session Key 持久化服务
"""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import get_gateway_config
from src.models.agent_session_key import AgentSessionKey

logger = logging.getLogger("clawnet.session_key")


async def upsert_session_key(
    db: AsyncSession,
    *,
    conversation_id: str,
    user_id: str,
    agent_id: str,
    session_key: str,
) -> None:
    """写入或更新 session key 记录（按 user_id + agent_id 去重）。"""
    user_uuid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
    agent_uuid = uuid.UUID(agent_id) if isinstance(agent_id, str) else agent_id

    gw_config = get_gateway_config(user_id if isinstance(user_id, str) else str(user_id))
    if not gw_config:
        return

    try:
        result = await db.execute(
            select(AgentSessionKey).where(
                and_(
                    AgentSessionKey.user_id == user_uuid,
                    AgentSessionKey.agent_id == agent_uuid,
                )
            )
        )
        existing = result.scalar_one_or_none()
        now = datetime.now(timezone.utc)

        if existing:
            existing.session_key = session_key
            existing.gateway_ws_url = gw_config.ws_url
            existing.gateway_token = gw_config.token
            existing.updated_at = now
        else:
            db.add(AgentSessionKey(
                user_id=user_uuid,
                agent_id=agent_uuid,
                session_key=session_key,
                gateway_ws_url=gw_config.ws_url,
                gateway_token=gw_config.token,
                updated_at=now,
            ))

        await db.flush()
    except Exception as e:
        logger.warning(f"[SessionKey] upsert failed: {e}")
