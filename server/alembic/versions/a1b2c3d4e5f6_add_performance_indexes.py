"""add performance indexes

Revision ID: a1b2c3d4e5f6
Revises: 2e4760fd4f94
Create Date: 2026-05-31 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '71bc9814c07d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Card: composite index for cursor pagination (workspace_id, created_at, id)
    op.create_index('ix_cards_workspace_created', 'cards', ['workspace_id', 'created_at', 'id'])

    # WorkspaceMember: index on user_id for membership lookups
    op.create_index('ix_workspace_members_user_id', 'workspace_members', ['user_id'])

    # ActivityLog: index on actor_id for activity queries by user
    op.create_index('ix_activity_logs_actor_id', 'activity_logs', ['actor_id'])

    # Comment: index on author_id for comment queries by author
    op.create_index('ix_comments_author_id', 'comments', ['author_id'])


def downgrade() -> None:
    op.drop_index('ix_comments_author_id', table_name='comments')
    op.drop_index('ix_activity_logs_actor_id', table_name='activity_logs')
    op.drop_index('ix_workspace_members_user_id', table_name='workspace_members')
    op.drop_index('ix_cards_workspace_created', table_name='cards')
