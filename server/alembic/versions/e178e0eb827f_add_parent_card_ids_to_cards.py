"""add parent_card_ids to cards

Revision ID: e178e0eb827f
Revises: 013_topic_clusters
Create Date: 2026-05-28 09:49:34.587091
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'e178e0eb827f'
down_revision: Union[str, None] = '013_topic_clusters'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('cards', sa.Column('parent_card_ids', postgresql.ARRAY(postgresql.UUID()), server_default='{}', nullable=False))


def downgrade() -> None:
    op.drop_column('cards', 'parent_card_ids')
