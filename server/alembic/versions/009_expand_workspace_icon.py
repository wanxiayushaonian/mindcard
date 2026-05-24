"""expand workspace icon column

Revision ID: 009
Revises: 008
Create Date: 2026-05-24
"""
from alembic import op

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE workspaces ALTER COLUMN icon TYPE VARCHAR(16)")


def downgrade() -> None:
    op.execute("ALTER TABLE workspaces ALTER COLUMN icon TYPE VARCHAR(8)")
