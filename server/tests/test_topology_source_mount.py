"""Unit tests for source-based card mounting (VISION 理念4).

A card created from a conversation should be mounted under that conversation's
node (the source), regardless of embedding similarity — not under whatever node
the embedding classifier thinks is the best topic match.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.topology import NodeCard
from app.services.topology import TopologyService
from tests.conftest import make_chat, mock_scalar_one_or_none


def _make_card(workspace_id: uuid.UUID) -> MagicMock:
    card = MagicMock()
    card.id = uuid.uuid4()
    card.workspace_id = workspace_id
    card.creator_id = uuid.uuid4()
    card.embedding = [0.1] * 128  # present, but the source path must win anyway
    return card


class TestSourceMounting:
    @pytest.fixture
    def workspace_id(self) -> uuid.UUID:
        return uuid.uuid4()

    def test_assign_to_source_node_ignores_embedding_similarity(
        self, workspace_id: uuid.UUID
    ) -> None:
        """Source node wins even when card/node embeddings would be dissimilar."""
        root = make_chat(workspace_id=workspace_id, node_type="root", title="主线")
        source = make_chat(workspace_id=workspace_id, node_type="branch", title="源对话")
        card = _make_card(workspace_id)

        db = AsyncMock()
        # `add` is synchronous in the real session — keep it a sync mock so the
        # recorded NodeCard is inspectable (AsyncMock would leak a coroutine).
        db.add = MagicMock()
        # 1. advisory lock  2. root query  3. default node query
        # 4. delete root attachment  5. existing-card check
        db.execute.side_effect = [
            AsyncMock(),
            mock_scalar_one_or_none(root),
            mock_scalar_one_or_none(source),
            AsyncMock(),
            mock_scalar_one_or_none(None),
        ]

        service = TopologyService()
        service._recalculate_node_centroid = AsyncMock()

        import asyncio

        asyncio.run(service.assign_card_to_node(db, card, source.id))

        # Card is bound exactly to the source node
        added = [c.args[0] for c in db.add.call_args_list]
        assert len(added) == 1
        nc = added[0]
        assert isinstance(nc, NodeCard)
        assert nc.chat_id == source.id
        assert nc.card_id == card.id

        # No embedding-based search was reached (exactly the 5 calls above)
        assert len(db.execute.call_args_list) == 5

    def test_assign_falls_back_to_root_when_no_source(
        self, workspace_id: uuid.UUID
    ) -> None:
        """Without a source node, a card with no embedding lands on the root."""
        root = make_chat(workspace_id=workspace_id, node_type="root", title="主线")
        card = _make_card(workspace_id)
        card.embedding = None  # no embedding → root fallback

        db = AsyncMock()
        db.add = MagicMock()
        # 1. advisory lock  2. root query  3. existing root-attachment check
        db.execute.side_effect = [
            AsyncMock(),
            mock_scalar_one_or_none(root),
            mock_scalar_one_or_none(None),
        ]

        service = TopologyService()
        service._recalculate_node_centroid = AsyncMock()

        import asyncio

        asyncio.run(service.assign_card_to_node(db, card, None))

        added = [c.args[0] for c in db.add.call_args_list]
        assert len(added) == 1
        nc = added[0]
        assert isinstance(nc, NodeCard)
        assert nc.chat_id == root.id
        assert nc.card_id == card.id
