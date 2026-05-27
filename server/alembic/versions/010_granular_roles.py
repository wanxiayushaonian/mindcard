"""granular workspace roles

Revision ID: 010_granular_roles
Revises: 360403bfe799
Create Date: 2026-05-26
"""
from alembic import op

revision = "010_granular_roles"
down_revision = "360403bfe799"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add CHECK constraint for valid roles
    op.execute(
        "ALTER TABLE workspace_members "
        "ADD CONSTRAINT check_role "
        "CHECK (role IN ('owner', 'admin', 'editor', 'viewer', 'pending'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE workspace_members DROP CONSTRAINT IF EXISTS check_role")
