"""add description to graph_entities

Revision ID: 5bd42f5a3eb2
Revises: a8be8758cd54
Create Date: 2026-06-09 14:17:48.938228
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '5bd42f5a3eb2'
down_revision: Union[str, None] = 'a8be8758cd54'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('graph_entities', sa.Column('description', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('graph_entities', 'description')
