"""switch embedding to ollama bge-m3 (768 -> 1024)

Revision ID: a5f08e067557
Revises: 264554558dd8
Create Date: 2026-06-02 20:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a5f08e067557"
down_revision: Union[str, None] = "264554558dd8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Drop IVFFlat indexes (they depend on vector dimension)
    op.execute("DROP INDEX IF EXISTS idx_cards_embedding")
    op.execute("DROP INDEX IF EXISTS idx_topics_centroid")

    # 2. NULL out existing embeddings (768-dim data is incompatible with 1024)
    op.execute("UPDATE cards SET embedding = NULL WHERE embedding IS NOT NULL")
    op.execute("UPDATE topics SET centroid = NULL WHERE centroid IS NOT NULL")
    op.execute("UPDATE graph_entities SET embedding = NULL WHERE embedding IS NOT NULL")
    op.execute("UPDATE tree_nodes SET embedding = NULL WHERE embedding IS NOT NULL")

    # 3. Alter vector columns from 768 to 1024
    op.execute("ALTER TABLE cards ALTER COLUMN embedding TYPE vector(1024)")
    op.execute("ALTER TABLE topics ALTER COLUMN centroid TYPE vector(1024)")
    op.execute("ALTER TABLE graph_entities ALTER COLUMN embedding TYPE vector(1024)")
    op.execute("ALTER TABLE tree_nodes ALTER COLUMN embedding TYPE vector(1024)")

    # 4. Recreate IVFFlat indexes
    op.execute(
        "CREATE INDEX idx_cards_embedding ON cards "
        "USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    )
    op.execute(
        "CREATE INDEX idx_topics_centroid ON topics "
        "USING ivfflat (centroid vector_cosine_ops) WITH (lists = 50)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_cards_embedding")
    op.execute("DROP INDEX IF EXISTS idx_topics_centroid")

    op.execute("UPDATE cards SET embedding = NULL")
    op.execute("UPDATE topics SET centroid = NULL")
    op.execute("UPDATE graph_entities SET embedding = NULL")
    op.execute("UPDATE tree_nodes SET embedding = NULL")

    op.execute("ALTER TABLE cards ALTER COLUMN embedding TYPE vector(768)")
    op.execute("ALTER TABLE topics ALTER COLUMN centroid TYPE vector(768)")
    op.execute("ALTER TABLE graph_entities ALTER COLUMN embedding TYPE vector(768)")
    op.execute("ALTER TABLE tree_nodes ALTER COLUMN embedding TYPE vector(768)")

    op.execute(
        "CREATE INDEX idx_cards_embedding ON cards "
        "USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    )
    op.execute(
        "CREATE INDEX idx_topics_centroid ON topics "
        "USING ivfflat (centroid vector_cosine_ops) WITH (lists = 50)"
    )
