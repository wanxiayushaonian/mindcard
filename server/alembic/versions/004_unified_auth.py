"""Add username/password fields for unified auth

Revision ID: 004
Revises: 003
Create Date: 2026-05-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add username column (unique, nullable, indexed)
    op.add_column("users", sa.Column("username", sa.String(32), nullable=True))
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    # Add password_hash column
    op.add_column("users", sa.Column("password_hash", sa.String(128), nullable=True))

    # Make wechat_openid nullable (was NOT NULL)
    op.alter_column("users", "wechat_openid", nullable=True)


def downgrade() -> None:
    op.alter_column("users", "wechat_openid", nullable=False)
    op.drop_column("users", "password_hash")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "username")
