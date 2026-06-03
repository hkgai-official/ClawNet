"""
DiscoveryTask 模型

管理多用户发现任务的生命周期。一个 DiscoveryTask 可以编排多个 A2A 对话，
实现链式发现和多目标并行询问。
"""

import uuid
from datetime import datetime, timezone
from enum import Enum
from sqlalchemy import String, DateTime, Text, Integer, ForeignKey, Index, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from src.database import Base


class DiscoveryTaskStatus(str, Enum):
    """发现任务状态"""
    PENDING = "pending"              # 等待用户确认执行
    RUNNING = "running"              # 有活跃的 A2A 会话
    COMPLETING = "completing"        # 所有子对话完成，正在汇总
    COMPLETED = "completed"          # 汇总完成
    CANCELLED = "cancelled"          # 用户取消
    FAILED = "failed"                # 异常失败


class DiscoveryTask(Base):
    """多用户发现任务"""
    __tablename__ = "discovery_tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # 关联原始会话
    source_conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 发起方
    initiator_agent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agents.id", ondelete="CASCADE"),
        nullable=False,
    )
    initiator_owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 状态
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=DiscoveryTaskStatus.PENDING.value,
    )
    original_intent: Mapped[str] = mapped_column(Text, nullable=False)

    # 限制
    max_hops: Mapped[int] = mapped_column(Integer, default=5)
    current_hop_count: Mapped[int] = mapped_column(Integer, default=0)
    max_concurrent: Mapped[int] = mapped_column(Integer, default=2)

    # JSON 字段：待询问列表 [{target_owner, topic, priority}]
    pending_queries: Mapped[list] = mapped_column(JSON, default=list)
    # JSON 字段：已完成结果 [{target_owner, topic, summary, session_id, status}]
    completed_results: Mapped[list] = mapped_column(JSON, default=list)
    # JSON 字段：进行中的会话 [{session_id, target_owner, topic}]
    active_sessions: Mapped[list] = mapped_column(JSON, default=list)

    # 乐观锁
    version: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")

    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # 关系
    source_conversation = relationship("Conversation")
    initiator_agent = relationship("Agent", foreign_keys=[initiator_agent_id])
    initiator_owner = relationship("User", foreign_keys=[initiator_owner_id])

    __table_args__ = (
        Index("idx_discovery_tasks_source_conv", "source_conversation_id"),
        Index("idx_discovery_tasks_status", "status"),
        Index("idx_discovery_tasks_initiator_agent", "initiator_agent_id"),
        Index("idx_discovery_tasks_initiator_owner", "initiator_owner_id"),
        Index("idx_discovery_tasks_created", "created_at"),
    )

    def can_add_hop(self) -> bool:
        """是否还能添加新的 A2A 跳转"""
        return (
            self.status in (DiscoveryTaskStatus.PENDING.value, DiscoveryTaskStatus.RUNNING.value)
            and self.current_hop_count < self.max_hops
        )

    def has_active_sessions(self) -> bool:
        """是否有进行中的子对话"""
        return bool(self.active_sessions)

    def has_pending_queries(self) -> bool:
        """是否有待处理的查询"""
        return bool(self.pending_queries)

    def is_all_done(self) -> bool:
        """所有子对话和查询是否都已完成"""
        return not self.has_active_sessions() and not self.has_pending_queries()
