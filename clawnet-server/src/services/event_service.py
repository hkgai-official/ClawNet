"""
事件投递服务

职责：
1. 将事件持久化到 user_events 表（与业务数据同事务）
2. 业务 commit 后，安全地通过 WebSocket 推送事件（失败不阻塞业务）
3. 用户上线时推送所有未消费事件
"""

import logging
import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.user_event import UserEvent

logger = logging.getLogger("clawnet.events")


class EventCollector:
    """在一次业务操作中收集待发送事件。

    用法：
        events = EventCollector()
        events.add(db, user_id, "dialog.completed", {...})
        events.add(db, user_id2, "dialog.completed", {...})
        await db.commit()          # 事件随业务数据一起持久化
        await events.deliver()     # commit 后安全投递，失败只记日志
    """

    def __init__(self):
        self._pending: list[tuple[str, str, dict, uuid.UUID]] = []

    def add(
        self,
        db: AsyncSession,
        user_id: str | uuid.UUID,
        event_type: str,
        payload: dict,
    ) -> None:
        """收集一个事件（同时写入 DB，跟随当前事务）"""
        uid = str(user_id)
        event = UserEvent(
            user_id=uuid.UUID(uid) if isinstance(user_id, str) else user_id,
            event_type=event_type,
            payload=payload,
        )
        db.add(event)
        self._pending.append((uid, event_type, payload, event.id))

    async def deliver(self) -> None:
        """commit 之后调用：通过 WS 投递所有收集的事件，失败静默记录。"""
        if not self._pending:
            return

        from src.websocket.manager import ws_manager
        from src.database import async_session

        for user_id, event_type, payload, event_id in self._pending:
            try:
                await ws_manager.send_to_user(user_id, {
                    "type": event_type,
                    "data": payload,
                })
                # 投递成功，标记已消费
                async with async_session() as db:
                    await db.execute(
                        update(UserEvent)
                        .where(UserEvent.id == event_id)
                        .values(consumed_at=datetime.now(timezone.utc))
                    )
                    await db.commit()
            except Exception as e:
                logger.warning(
                    "Failed to deliver event %s to user %s: %s",
                    event_type, user_id[:8], e,
                )
                # 事件已持久化，用户上线时会重新投递

        self._pending.clear()


async def deliver_pending_events(user_id: str) -> int:
    """用户上线时调用：推送所有未消费事件。

    Returns:
        投递成功的事件数
    """
    from src.websocket.manager import ws_manager
    from src.database import async_session

    delivered = 0
    async with async_session() as db:
        result = await db.execute(
            select(UserEvent)
            .where(
                UserEvent.user_id == uuid.UUID(user_id),
                UserEvent.consumed_at.is_(None),
            )
            .order_by(UserEvent.created_at.asc())
            .limit(100)  # 防止积压过多一次性推送
        )
        events = result.scalars().all()

        if not events:
            return 0

        logger.info(
            "Delivering %d pending events to user %s",
            len(events), user_id[:8],
        )

        consumed_ids: list[uuid.UUID] = []
        for event in events:
            try:
                await ws_manager.send_to_user(user_id, {
                    "type": event.event_type,
                    "data": event.payload,
                    "replay": True,  # 标记为离线补发，前端跳过通知弹窗
                })
                consumed_ids.append(event.id)
                delivered += 1
            except Exception as e:
                logger.warning(
                    "Failed to deliver pending event %s to user %s: %s",
                    event.event_type, user_id[:8], e,
                )
                break  # 连接可能已断开，停止投递

        if consumed_ids:
            await db.execute(
                update(UserEvent)
                .where(UserEvent.id.in_(consumed_ids))
                .values(consumed_at=datetime.now(timezone.utc))
            )
            await db.commit()

    return delivered


async def cleanup_old_events(days: int = 7) -> int:
    """清理已消费的旧事件（定期调用）。

    Returns:
        删除的事件数
    """
    from src.database import async_session
    from sqlalchemy import delete

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    async with async_session() as db:
        result = await db.execute(
            delete(UserEvent).where(
                UserEvent.consumed_at.is_not(None),
                UserEvent.created_at < cutoff,
            )
        )
        await db.commit()
        count = result.rowcount
        if count:
            logger.info("Cleaned up %d old consumed events", count)
        return count
