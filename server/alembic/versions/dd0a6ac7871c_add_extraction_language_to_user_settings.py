"""add_extraction_language_to_user_settings

Revision ID: dd0a6ac7871c
Revises: 439a0e95fc2d
Create Date: 2026-06-01 19:30:29.132342
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dd0a6ac7871c'
down_revision: Union[str, None] = '439a0e95fc2d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user_settings', sa.Column('extraction_language', sa.String(length=8), nullable=False, server_default='zh'))


def downgrade() -> None:
    op.drop_column('user_settings', 'extraction_language')
