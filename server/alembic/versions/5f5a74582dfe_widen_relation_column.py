"""widen relation column

Revision ID: 5f5a74582dfe
Revises: 016_drop_tree_nodes
Create Date: 2026-06-05 20:34:10.479522
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '5f5a74582dfe'
down_revision: Union[str, None] = '016_drop_tree_nodes'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'graph_relations', 'relation',
        existing_type=sa.VARCHAR(length=128),
        type_=sa.Text(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        'graph_relations', 'relation',
        existing_type=sa.Text(),
        type_=sa.VARCHAR(length=128),
        existing_nullable=False,
    )
