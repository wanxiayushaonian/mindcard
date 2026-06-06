"""Unit tests for SearchService."""

import pytest

from app.services.search import ScoredCard, _ws_filter


class TestWsFilter:
    """Tests for _ws_filter helper."""

    def test_none_returns_empty(self):
        assert _ws_filter(None) == []

    def test_empty_list_returns_empty(self):
        assert _ws_filter([]) == []

    def test_non_empty_returns_clause(self):
        import uuid

        ids = [uuid.uuid4()]
        result = _ws_filter(ids)
        assert len(result) == 1


class TestScoredCard:
    """Tests for ScoredCard dataclass."""

    def test_construction(self):
        from unittest.mock import MagicMock

        card = MagicMock()
        scored = ScoredCard(card=card, score=0.85)
        assert scored.card is card
        assert scored.score == 0.85
