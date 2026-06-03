"""
用户事件表

持久化发送给用户的实时事件，确保离线用户上线后能收到错过的通知。
每个事件对应一次 WebSocket 推送，consumed_at 标记是否已成功投递。
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, JSON, Index, text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID

from src.database import Base


class UserEvent(Base):
    __tablename__ = "user_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True,
    )
    event_type: Mapped[str] = mapped_column(
        String(50), nullable=False,
    )
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    consumed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None,
    )

    __table_args__ = (
        # 查询未消费事件：WHERE user_id = ? AND consumed_at IS NULL ORDER BY created_at
        Index(
            "idx_user_events_pending",
            "user_id",
            "created_at",
            postgresql_where=text("consumed_at IS NULL"),
        ),
    )
