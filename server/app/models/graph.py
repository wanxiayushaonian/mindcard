from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import Float, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy import TIMESTAMP
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import settings
from app.database import Base


class GraphEntity(Base):
    __tablename__ = "graph_entities"

    id: Mapped[str] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(64))
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

    id: Mapped[str] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    head_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("graph_entities.id", ondelete="CASCADE"), nullable=False
    )
    relation: Mapped[str] = mapped_column(Text, nullable=False)
    tail_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("graph_entities.id", ondelete="CASCADE"), nullable=False
    )
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    source_card_id: Mapped[str | None] = mapped_column(
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

    entity_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("graph_entities.id", ondelete="CASCADE"), primary_key=True
    )
    card_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True
    )


class GNNTrainingLog(Base):
    __tablename__ = "gnn_training_logs"

    id: Mapped[str] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    training_mode: Mapped[str] = mapped_column(String(32), nullable=False)
    graph_size_nodes: Mapped[int] = mapped_column(Integer, nullable=False)
    graph_size_edges: Mapped[int] = mapped_column(Integer, nullable=False)
    checkpoint_path: Mapped[str] = mapped_column(Text, nullable=False)
    training_duration_seconds: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))


class TripleFeedback(Base):
    __tablename__ = "triple_feedback"

    id: Mapped[str] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    triple_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("graph_relations.id"), nullable=True
    )
    user_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    feedback_type: Mapped[str] = mapped_column(String(32), nullable=False)
    corrected_head: Mapped[str | None] = mapped_column(Text)
    corrected_relation: Mapped[str | None] = mapped_column(String(128))
    corrected_tail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
