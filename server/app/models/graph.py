from datetime import datetime, timezone
import uuid as _uuid
from typing import TYPE_CHECKING
from uuid import uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import Float, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy import TIMESTAMP
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.config import settings
from app.database import Base


class GraphEntity(Base):
    __tablename__ = "graph_entities"

    id: Mapped[_uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[_uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(64))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(settings.embedding_dim), nullable=True)
    access_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        Index("idx_graph_entities_workspace", "workspace_id"),
    )

    if TYPE_CHECKING:
        from app.models.card import Card
        cards: list[Card]


class GraphRelation(Base):
    __tablename__ = "graph_relations"

    id: Mapped[_uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[_uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    head_id: Mapped[_uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("graph_entities.id", ondelete="CASCADE"), nullable=False
    )
    relation: Mapped[str] = mapped_column(Text, nullable=False)
    tail_id: Mapped[_uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("graph_entities.id", ondelete="CASCADE"), nullable=False
    )
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    source_card_id: Mapped[_uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cards.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        Index("idx_graph_relations_workspace", "workspace_id"),
        Index("idx_graph_relations_head", "head_id"),
        Index("idx_graph_relations_tail", "tail_id"),
    )


class EntityCard(Base):
    __tablename__ = "entity_cards"

    entity_id: Mapped[_uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("graph_entities.id", ondelete="CASCADE"), primary_key=True
    )
    card_id: Mapped[_uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True
    )


class Community(Base):
    """A cluster of related entities detected by Leiden community detection."""
    __tablename__ = "communities"

    id: Mapped[_uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[_uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    entity_ids: Mapped[list] = mapped_column(ARRAY(Uuid(as_uuid=True)), nullable=False, default=list)
    relationship_ids: Mapped[list] = mapped_column(ARRAY(Uuid(as_uuid=True)), nullable=False, default=list)
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        Index("idx_communities_workspace", "workspace_id"),
        Index("idx_communities_level", "workspace_id", "level"),
    )


class CommunityReport(Base):
    """LLM-generated summary for a community cluster."""
    __tablename__ = "community_reports"

    id: Mapped[_uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    community_id: Mapped[_uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("communities.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    workspace_id: Mapped[_uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    findings: Mapped[list | None] = mapped_column(ARRAY(Text), nullable=True)
    rating: Mapped[float] = mapped_column(Float, nullable=False, default=5.0)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(settings.embedding_dim), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("idx_community_reports_workspace", "workspace_id"),
    )
