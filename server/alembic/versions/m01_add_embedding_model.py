"""add embedding_model columns

Revision ID: m01_add_embedding_model
Revises: l01_add_card_processing_jobs
Create Date: 2026-08-19

Records which embedding model produced each stored vector so mixed-model
data can be detected (and re-embedded) after an EMBEDDING_MODEL change.
"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "m01_add_embedding_model"
down_revision: Union[str, None] = "l01_add_card_processing_jobs"
branch_labels = None
depends_on = None

_VECTOR_TABLES = [
    "cards",
    "card_chunks",
    "graph_entities",
    "community_reports",
    "ai_chats",
    "topics",
    "workspace_memories",
]


def upgrade() -> None:
    for table in _VECTOR_TABLES:
        op.add_column(table, sa.Column("embedding_model", sa.String(64), nullable=True))


def downgrade() -> None:
    for table in _VECTOR_TABLES:
        op.drop_column(table, "embedding_model")
