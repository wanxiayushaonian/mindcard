"""Unit tests for TripleExtractor."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.triple_extractor import (
    ExtractedEntity,
    ExtractedTriple,
    TripleExtractor,
)


class TestExtractedEntity:
    """Tests for ExtractedEntity dataclass."""

    def test_with_type(self):
        e = ExtractedEntity(name="Python", entity_type="language")
        assert e.name == "Python"
        assert e.entity_type == "language"

    def test_without_type(self):
        e = ExtractedEntity(name="Python")
        assert e.entity_type is None


class TestExtractedTriple:
    """Tests for ExtractedTriple dataclass."""

    def test_construction(self):
        t = ExtractedTriple(head="Python", relation="is_a", tail="language")
        assert t.head == "Python"
        assert t.relation == "is_a"
        assert t.tail == "language"


class TestExtractEntitiesOnly:
    """Tests for extract_entities_only() with mocked LLM."""

    @pytest.mark.asyncio
    async def test_valid_entity_list(self):
        extractor = TripleExtractor()
        llm_response = "Python\nFastAPI\nDocker"

        with patch("app.services.triple_extractor.get_llm_service") as mock_get_llm:
            mock_llm = MagicMock()
            mock_llm.extraction_complete_simple = AsyncMock(return_value=llm_response)
            mock_get_llm.return_value = mock_llm

            entities = await extractor.extract_entities_only("some text")

            assert len(entities) == 3
            assert entities[0].name == "Python"
            assert entities[1].name == "FastAPI"
            assert entities[2].name == "Docker"
            assert all(e.entity_type is None for e in entities)

    @pytest.mark.asyncio
    async def test_strips_bullet_prefixes(self):
        extractor = TripleExtractor()
        llm_response = "- Python\n• FastAPI\n· Docker"

        with patch("app.services.triple_extractor.get_llm_service") as mock_get_llm:
            mock_llm = MagicMock()
            mock_llm.extraction_complete_simple = AsyncMock(return_value=llm_response)
            mock_get_llm.return_value = mock_llm

            entities = await extractor.extract_entities_only("some text")

            assert len(entities) == 3
            assert entities[0].name == "Python"
            assert entities[1].name == "FastAPI"
            assert entities[2].name == "Docker"

    @pytest.mark.asyncio
    async def test_empty_llm_response(self):
        extractor = TripleExtractor()

        with patch("app.services.triple_extractor.get_llm_service") as mock_get_llm:
            mock_llm = MagicMock()
            mock_llm.extraction_complete_simple = AsyncMock(return_value="")
            mock_get_llm.return_value = mock_llm

            entities = await extractor.extract_entities_only("some text")
            assert entities == []

    @pytest.mark.asyncio
    async def test_whitespace_only_response(self):
        extractor = TripleExtractor()

        with patch("app.services.triple_extractor.get_llm_service") as mock_get_llm:
            mock_llm = MagicMock()
            mock_llm.extraction_complete_simple = AsyncMock(return_value="   \n  ")
            mock_get_llm.return_value = mock_llm

            entities = await extractor.extract_entities_only("some text")
            assert entities == []

    @pytest.mark.asyncio
    async def test_llm_exception(self):
        extractor = TripleExtractor()

        with patch("app.services.triple_extractor.get_llm_service") as mock_get_llm:
            mock_llm = MagicMock()
            mock_llm.extraction_complete_simple = AsyncMock(
                side_effect=Exception("LLM error")
            )
            mock_get_llm.return_value = mock_llm

            entities = await extractor.extract_entities_only("some text")
            assert entities == []


class TestParseResponse:
    """Tests for _parse_response() — synchronous tuple-format parsing."""

    def test_entity_records(self):
        extractor = TripleExtractor()
        response = (
            "(entity<|>Python<|>language<|>desc)\n"
            "##\n"
            "(entity<|>FastAPI<|>framework<|>desc)\n"
            "##\n"
            "<|COMPLETE|>"
        )

        entities, triples = extractor._parse_response(response)

        assert len(entities) == 2
        assert entities[0].name == "Python"
        assert entities[1].name == "FastAPI"
        assert len(triples) == 0

    def test_relationship_records(self):
        extractor = TripleExtractor()
        response = (
            "(entity<|>Python<|>language<|>desc)\n"
            "##\n"
            "(entity<|>FastAPI<|>framework<|>desc)\n"
            "##\n"
            "(relationship<|>FastAPI<|>Python<|>FastAPI is built with Python<|>9)\n"
            "##\n"
            "<|COMPLETE|>"
        )

        entities, triples = extractor._parse_response(response)

        assert len(entities) == 2
        assert {e.name for e in entities} == {"Python", "FastAPI"}
        assert len(triples) == 1
        assert triples[0].head == "FastAPI"
        assert triples[0].tail == "Python"
        assert triples[0].relation == "FastAPI is built with Python"

    def test_empty_response(self):
        extractor = TripleExtractor()
        entities, triples = extractor._parse_response("")
        assert entities == []
        assert triples == []

    def test_complete_only(self):
        extractor = TripleExtractor()
        entities, triples = extractor._parse_response("<|COMPLETE|>")
        assert entities == []
        assert triples == []


class TestExtract:
    """Tests for the top-level extract() method."""

    @pytest.mark.asyncio
    async def test_empty_entities_returns_empty(self):
        extractor = TripleExtractor()

        with patch.object(
            extractor, "_single_pass", AsyncMock(return_value=([], []))
        ):
            entities, triples = await extractor.extract("text", __import__("uuid").uuid4())
            assert entities == []
            assert triples == []
