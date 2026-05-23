"""Revert embedding dimension to 768 to match actual bge-base-zh-v1.5 model

Revision ID: 007
Revises: 006
Create Date: 2026-05-23
"""
from typing import Sequence, Union

from alembic import op

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_cards_embedding")
    op.execute("ALTER TABLE cards ALTER COLUMN embedding TYPE vector(768)")
    op.execute(
        "CREATE INDEX idx_cards_embedding ON cards USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_cards_embedding")
    op.execute("ALTER TABLE cards ALTER COLUMN embedding TYPE vector(1024)")
    op.execute(
        "CREATE INDEX idx_cards_embedding ON cards USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    )
