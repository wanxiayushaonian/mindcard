"""Unit tests for SearchService."""

import uuid

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.search import ScoredCard, _ws_filter, search_service
from tests.conftest import make_card, sample_embedding


# ---------------------------------------------------------------------------
# Path A / Path B mock helpers
# ---------------------------------------------------------------------------


def _make_chunk_row(card_id, best_dist=0.2):
    """Simulate a Path A chunk query row: Row(card_id, best_dist)."""
    row = MagicMock()
    row.card_id = card_id
    row.best_dist = best_dist
    return row


def _chunk_result(rows):
    """Simulate chunk_stmt execute result; .all() returns rows."""
    r = MagicMock()
    r.all.return_value = rows
    return r


def _card_scalars_result(cards):
    """Simulate card load query result; .scalars().all() returns cards."""
    r = MagicMock()
    r.scalars.return_value.all.return_value = cards
    return r


def _fallback_result(pairs):
    """Simulate Path B fallback result; .all() returns [(card, dist), ...] pairs."""
    r = MagicMock()
    r.all.return_value = pairs
    return r


class TestWsFilter:
    """Tests for _ws_filter helper."""

    def test_none_returns_empty(self):
        assert _ws_filter(None) == []

    def test_empty_list_returns_empty(self):
        assert _ws_filter([]) == []

    def test_non_empty_returns_clause(self):
        ids = [uuid.uuid4()]
        result = _ws_filter(ids)
        assert len(result) == 1


class TestScoredCard:
    """Tests for ScoredCard dataclass."""

    def test_construction(self):
        card = MagicMock()
        scored = ScoredCard(card=card, score=0.85)
        assert scored.card is card
        assert scored.score == 0.85


class TestVectorSearch:
    """Integration tests for SearchService.vector_search() two-path mock strategy."""

    @pytest.mark.asyncio
    async def test_empty_query_returns_empty_without_db_call(self, mock_db):
        result = await search_service.vector_search(mock_db, "   ")
        assert result == []
        mock_db.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_embed_failure_returns_empty(self, mock_db):
        with patch("app.services.search.embedding_service.embed", side_effect=RuntimeError("embed error")):
            result = await search_service.vector_search(mock_db, "some query")
        assert result == []
        mock_db.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_path_a_only_returns_chunked_cards(self, mock_db):
        card = make_card(embedding=sample_embedding())
        mock_db.execute.side_effect = [
            _chunk_result([_make_chunk_row(card.id, best_dist=0.3)]),  # Path A chunk query
            _card_scalars_result([card]),                               # Path A card load
            _fallback_result([]),                                       # Path B fallback (empty)
        ]
        with patch("app.services.search.embedding_service.embed", return_value=sample_embedding(seed=1)):
            result = await search_service.vector_search(mock_db, "test query")

        assert len(result) == 1
        assert result[0].card is card
        assert abs(result[0].score - (1.0 - 0.3 / 2.0)) < 1e-9  # 0.85
        assert mock_db.execute.call_count == 3

    @pytest.mark.asyncio
    async def test_path_b_fallback_when_no_chunks(self, mock_db):
        card = make_card(embedding=sample_embedding())
        mock_db.execute.side_effect = [
            _chunk_result([]),                      # Path A: no chunk rows
            _fallback_result([(card, 0.4)]),        # Path B: fallback returns card
        ]
        with patch("app.services.search.embedding_service.embed", return_value=sample_embedding(seed=2)):
            result = await search_service.vector_search(mock_db, "test query")

        assert len(result) == 1
        assert result[0].card is card
        assert abs(result[0].score - (1.0 - 0.4 / 2.0)) < 1e-9  # 0.8
        assert mock_db.execute.call_count == 2

    @pytest.mark.asyncio
    async def test_mixed_paths_merged_and_sorted(self, mock_db):
        card_a = make_card(embedding=sample_embedding(seed=10))
        card_b = make_card(embedding=sample_embedding(seed=11))
        # card_a via Path A: dist=0.1 → score=0.95
        # card_b via Path B: dist=0.2 → score=0.9
        mock_db.execute.side_effect = [
            _chunk_result([_make_chunk_row(card_a.id, 0.1)]),  # Path A chunk
            _card_scalars_result([card_a]),                     # Path A card load
            _fallback_result([(card_b, 0.2)]),                  # Path B fallback
        ]
        with patch("app.services.search.embedding_service.embed", return_value=sample_embedding(seed=3)):
            result = await search_service.vector_search(mock_db, "test query")

        assert len(result) == 2
        assert result[0].card is card_a  # higher score first
        assert result[1].card is card_b
        assert abs(result[0].score - 0.95) < 1e-9  # 1.0 - 0.1/2
        assert abs(result[1].score - 0.9) < 1e-9   # 1.0 - 0.2/2

    @pytest.mark.asyncio
    async def test_limit_respected(self, mock_db):
        cards = [make_card(embedding=sample_embedding(seed=i)) for i in range(3)]
        # Path A: 1 chunk row (cards[0] dist=0.1 → score=0.95)
        # Path B: 2 fallback rows (cards[1] dist=0.3 → score=0.85, cards[2] dist=0.5 → score=0.75)
        # Merged 3 results, limit=2 → top 2 by score: cards[0] (0.95), cards[1] (0.85)
        mock_db.execute.side_effect = [
            _chunk_result([_make_chunk_row(cards[0].id, 0.1)]),           # Path A chunk query
            _card_scalars_result([cards[0]]),                              # Path A card load
            _fallback_result([(cards[1], 0.3), (cards[2], 0.5)]),         # Path B fallback
        ]
        with patch("app.services.search.embedding_service.embed", return_value=sample_embedding(seed=4)):
            result = await search_service.vector_search(mock_db, "test query", limit=2)

        assert len(result) == 2
        assert result[0].card is cards[0]   # score=0.95 (highest)
        assert result[1].card is cards[1]   # score=0.85
        assert mock_db.execute.call_count == 3

    @pytest.mark.asyncio
    async def test_path_b_outranks_path_a_when_closer(self, mock_db):
        card_a = make_card(embedding=sample_embedding(seed=20))
        card_b = make_card(embedding=sample_embedding(seed=21))
        # card_a via Path A: dist=0.8 → score=0.6
        # card_b via Path B: dist=0.2 → score=0.9
        mock_db.execute.side_effect = [
            _chunk_result([_make_chunk_row(card_a.id, 0.8)]),  # Path A chunk query
            _card_scalars_result([card_a]),                     # Path A card load
            _fallback_result([(card_b, 0.2)]),                  # Path B fallback
        ]
        with patch("app.services.search.embedding_service.embed", return_value=sample_embedding(seed=5)):
            result = await search_service.vector_search(mock_db, "test query")

        assert len(result) == 2
        assert result[0].card is card_b  # Path B result ranks first (score=0.9 > 0.6)

    @pytest.mark.asyncio
    async def test_chunk_row_with_none_dist_gets_zero_score(self, mock_db):
        card = make_card(embedding=sample_embedding())
        # best_dist=None triggers the fallback: dist = 2.0 → score = 1.0 - 2.0/2.0 = 0.0
        mock_db.execute.side_effect = [
            _chunk_result([_make_chunk_row(card.id, best_dist=None)]),  # Path A chunk query
            _card_scalars_result([card]),                                # Path A card load
            _fallback_result([]),                                        # Path B fallback (empty)
        ]
        with patch("app.services.search.embedding_service.embed", return_value=sample_embedding(seed=6)):
            result = await search_service.vector_search(mock_db, "test query")

        assert len(result) == 1
        assert result[0].card is card
        assert abs(result[0].score - 0.0) < 1e-9

    @pytest.mark.asyncio
    async def test_chunk_row_missing_from_card_load_is_skipped(self, mock_db):
        card = make_card(embedding=sample_embedding())
        # chunk query returns a card_id, but card load returns empty (card deleted)
        mock_db.execute.side_effect = [
            _chunk_result([_make_chunk_row(card.id, 0.2)]),  # Path A chunk query
            _card_scalars_result([]),                         # card load: empty (card missing)
            _fallback_result([]),                             # Path B fallback (empty)
        ]
        with patch("app.services.search.embedding_service.embed", return_value=sample_embedding(seed=7)):
            result = await search_service.vector_search(mock_db, "test query")

        assert result == []
