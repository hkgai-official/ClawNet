"""
AgentDialogSession 模型

用于管理 Agent 间对话的会话状态，包括：
- 参与方信息（发起方/接收方 Agent 及其 Owner）
- 授权状态
- 会话控制（状态、轮数、超时）
- 终止信息
"""

import uuid
from datetime import datetime, timezone
from enum import Enum
from sqlalchemy import String, DateTime, Text, Integer, Boolean, ForeignKey, Index, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from src.database import Base


class DialogSessionStatus(str, Enum):
    """对话会话状态"""
    PENDING_APPROVAL = "pending_approval"  # 等待双方 Owner 授权
    ACTIVE = "active"                      # 对话进行中
    PAUSED = "paused"                      # 暂停（等待 Owner 决定）
    COMPLETED = "completed"                # 正常完成
    TERMINATED = "terminated"              # 异常终止


class TerminationReason(str, Enum):
    """终止原因"""
    RESOLVED = "resolved"                  # 问题已解决
    DEADLOCK = "deadlock"                  # 陷入僵局
    ROUNDS_EXCEEDED = "rounds_exceeded"    # 超出轮数限制
    OWNER_TERMINATED = "owner_terminated"  # Owner 手动终止
    OWNER_REJECTED = "owner_rejected"      # Owner 拒绝授权
    TIMEOUT = "timeout"                    # 超时
    AGENT_OFFLINE = "agent_offline"        # Agent 离线
    NESTED_DIALOG = "nested_dialog"        # 等待嵌套对话完成


class AgentDialogSession(Base):
    """Agent 间对话会话"""
    __tablename__ = "agent_dialog_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    
    # 复用现有会话
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        ForeignKey("conversations.id", ondelete="CASCADE"), 
        nullable=False
    )
    
    # 参与方
    initiator_agent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        ForeignKey("agents.id", ondelete="CASCADE"), 
        nullable=False
    )
    responder_agent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        ForeignKey("agents.id", ondelete="CASCADE"), 
        nullable=False
    )
    initiator_owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        ForeignKey("users.id", ondelete="CASCADE"), 
        nullable=False
    )
    responder_owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        ForeignKey("users.id", ondelete="CASCADE"), 
        nullable=False
    )
    
    # 议题
    topic: Mapped[str] = mapped_column(Text, nullable=False)
    
    # 授权状态
    initiator_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    responder_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    
    # 会话控制
    status: Mapped[str] = mapped_column(
        String(20), 
        nullable=False, 
        default=DialogSessionStatus.PENDING_APPROVAL.value
    )
    current_round: Mapped[int] = mapped_column(Integer, default=0)
    max_rounds: Mapped[int] = mapped_column(Integer, default=10)
    idle_timeout_seconds: Mapped[int] = mapped_column(Integer, default=86400)

    # 乐观锁版本号，用于防止并发修改导致的竞态条件
    version: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    
    # 终止信息
    termination_reason: Mapped[str | None] = mapped_column(String(30), nullable=True)
    
    # 元数据（用于存储原始会话信息等）
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    
    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        default=lambda: datetime.now(timezone.utc)
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), 
        nullable=True
    )
    last_message_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), 
        nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), 
        nullable=True
    )

    # 关系
    conversation = relationship("Conversation")
    initiator_agent = relationship("Agent", foreign_keys=[initiator_agent_id])
    responder_agent = relationship("Agent", foreign_keys=[responder_agent_id])
    initiator_owner = relationship("User", foreign_keys=[initiator_owner_id])
    responder_owner = relationship("User", foreign_keys=[responder_owner_id])

    __table_args__ = (
        Index("idx_dialog_sessions_conversation", "conversation_id"),
        Index("idx_dialog_sessions_status", "status"),
        Index("idx_dialog_sessions_initiator_agent", "initiator_agent_id"),
        Index("idx_dialog_sessions_responder_agent", "responder_agent_id"),
        Index("idx_dialog_sessions_initiator_owner", "initiator_owner_id"),
        Index("idx_dialog_sessions_responder_owner", "responder_owner_id"),
    )

    def is_participant_agent(self, agent_id: uuid.UUID) -> bool:
        """检查 agent 是否是参与方"""
        return agent_id in (self.initiator_agent_id, self.responder_agent_id)

    def is_participant_owner(self, user_id: uuid.UUID) -> bool:
        """检查用户是否是参与方的 Owner"""
        return user_id in (self.initiator_owner_id, self.responder_owner_id)

    def get_other_agent_id(self, agent_id: uuid.UUID) -> uuid.UUID | None:
        """获取对方 agent 的 ID"""
        if agent_id == self.initiator_agent_id:
            return self.responder_agent_id
        elif agent_id == self.responder_agent_id:
            return self.initiator_agent_id
        return None

    def is_fully_approved(self) -> bool:
        """检查是否双方都已授权"""
        return self.initiator_approved and self.responder_approved

    def can_continue(self) -> bool:
        """检查对话是否可以继续"""
        return (
            self.status == DialogSessionStatus.ACTIVE.value
            and self.current_round < self.max_rounds
        )
