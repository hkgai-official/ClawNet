import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, DateTime, JSON, ForeignKey, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from src.database import Base


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    display_name: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="online")
    agent_type: Mapped[str] = mapped_column(String(20), nullable=False, default="general")
    capabilities: Mapped[list] = mapped_column(ARRAY(String), default=list)
    execution_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="hybrid")
    interaction_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="background")
    model_config_data: Mapped[dict | None] = mapped_column("model_config", JSON, nullable=True)
    permission_scope: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    proactive_rules: Mapped[list] = mapped_column(JSON, default=list)
    proactive_intensity: Mapped[str] = mapped_column(String(20), default="medium")
    system_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    tag_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tags.id", ondelete="SET NULL"), nullable=True
    )
    tag_role: Mapped[str | None] = mapped_column(
        String(20), nullable=True, default=None
    )

    owner = relationship("User", back_populates="agents")
    tasks = relationship("Task", back_populates="agent", cascade="all, delete-orphan")
    tag = relationship("Tag", foreign_keys=[tag_id])
