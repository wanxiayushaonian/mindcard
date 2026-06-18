import uuid
from datetime import datetime, timezone

from sqlalchemy import Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, TIMESTAMP, UUID
from sqlalchemy.orm import Mapped, mapped_column

from pgvector.sqlalchemy import Vector

from app.database import Base
from app.config import settings


class WorkspaceMemory(Base):
    __tablename__ = "workspace_memories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    source_chat_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_chats.id", ondelete="SET NULL"), nullable=True
    )
    memory_type: Mapped[str] = mapped_column(String(20), nullable=False, default="fact")
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    importance: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    source_card_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, default=list
    )
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(settings.embedding_dim), nullable=True
    )
    last_accessed_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), onupdate=lambda: datetime.now(timezone.utc)
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        UniqueConstraint("workspace_id", "slug", name="uq_workspace_memory_slug"),
    )
