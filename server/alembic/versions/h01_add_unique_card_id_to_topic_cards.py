"""add unique constraint on topic_cards.card_id

Revision ID: h01_topic_card_unique
Revises: g01_restore_workspace_memories
Create Date: 2026-06-14 19:30:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "h01_topic_card_unique"
down_revision: Union[str, None] = "g01_restore_workspace_memories"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # topic.py uses ON CONFLICT (card_id) which requires a unique constraint on card_id alone.
    # The existing composite PK (topic_id, card_id) only guarantees uniqueness of the pair,
    # not of card_id alone. A card must belong to at most one topic at a time.
    op.create_unique_constraint(
        "uq_topic_cards_card_id",
        "topic_cards",
        ["card_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_topic_cards_card_id", "topic_cards", type_="unique")
