"""add communities and community_reports

Revision ID: aaf63648ad10
Revises: 5bd42f5a3eb2
Create Date: 2026-06-09 14:23:28.597166
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from pgvector.sqlalchemy import Vector

# revision identifiers, used by Alembic.
revision: str = 'aaf63648ad10'
down_revision: Union[str, None] = '5bd42f5a3eb2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('communities',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('workspace_id', sa.Uuid(), nullable=False),
        sa.Column('title', sa.String(length=256), nullable=False),
        sa.Column('level', sa.Integer(), nullable=False),
        sa.Column('entity_ids', postgresql.ARRAY(sa.Uuid()), nullable=False),
        sa.Column('relationship_ids', postgresql.ARRAY(sa.Uuid()), nullable=False),
        sa.Column('size', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_communities_level', 'communities', ['workspace_id', 'level'], unique=False)
    op.create_index('idx_communities_workspace', 'communities', ['workspace_id'], unique=False)

    op.create_table('community_reports',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('community_id', sa.Uuid(), nullable=False),
        sa.Column('workspace_id', sa.Uuid(), nullable=False),
        sa.Column('title', sa.String(length=256), nullable=False),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('findings', postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column('rating', sa.Float(), nullable=False),
        sa.Column('embedding', Vector(1024), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['community_id'], ['communities.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('community_id'),
    )
    op.create_index('idx_community_reports_workspace', 'community_reports', ['workspace_id'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_community_reports_workspace', table_name='community_reports')
    op.drop_table('community_reports')
    op.drop_index('idx_communities_workspace', table_name='communities')
    op.drop_index('idx_communities_level', table_name='communities')
    op.drop_table('communities')
