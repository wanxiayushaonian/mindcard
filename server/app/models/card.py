import uuid
from datetime import datetime, timezone

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, Float, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, TIMESTAMP, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.database import Base


class Card(Base):
    __tablename__ = "cards"
    __table_args__ = (
        Index("ix_cards_workspace_created", "workspace_id", "created_at", "id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    local_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    creator_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(128), default="")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    keywords: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    color: Mapped[str] = mapped_column(String(16), default="#B8D4E3")
    emotion_tag: Mapped[str] = mapped_column(String(32), default="")
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    is_temp: Mapped[bool] = mapped_column(Boolean, default=True)
    parent_card_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), default=list)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(settings.embedding_dim), nullable=True)
    fts_vector: Mapped[str | None] = mapped_column(TSVECTOR, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)


class CardRelation(Base):
    __tablename__ = "card_relations"

    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True
    )
    related_card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True
    )
    relation_type: Mapped[str] = mapped_column(
        String(16), primary_key=True
    )  # 'manual' | 'agent'
    score: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
