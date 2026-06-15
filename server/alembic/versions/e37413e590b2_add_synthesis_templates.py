"""add_synthesis_templates

Revision ID: e37413e590b2
Revises: aaf63648ad10, f1a2b3c4d5e6
Create Date: 2026-06-14 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP


# revision identifiers, used by Alembic.
revision: str = 'e37413e590b2'
down_revision: Union[tuple[str, ...], str, None] = ('aaf63648ad10', 'f1a2b3c4d5e6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'synthesis_templates',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('workspace_id', UUID(as_uuid=True), sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(128), nullable=False),
        sa.Column('prompt', sa.Text, nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_synthesis_templates_workspace_id', 'synthesis_templates', ['workspace_id'])


def downgrade() -> None:
    op.drop_index('ix_synthesis_templates_workspace_id', table_name='synthesis_templates')
    op.drop_table('synthesis_templates')
