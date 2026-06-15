"""Unit tests for TripleExtractor."""

import json
from unittest.mock import AsyncMock, patch

import pytest

from app.services.triple_extractor import (
    ExtractedEntity,
    ExtractedTriple,
    TripleExtractor,
)


class TestParseJson:
    """Pure function tests for _parse_json()."""

    def test_valid_json_array(self):
        data = [{"name": "Python", "type": "language"}]
        result = TripleExtractor._parse_json(json.dumps(data))
        assert result == data

    def test_valid_json_nested(self):
        data = [["Python", "is_a", "language"]]
        result = TripleExtractor._parse_json(json.dumps(data))
        assert result == data

    def test_markdown_fence_json(self):
        data = [{"name": "test"}]
        text = f"```json\n{json.dumps(data)}\n```"
        result = TripleExtractor._parse_json(text)
        assert result == data

    def test_plain_fence(self):
        data = [{"name": "test"}]
        text = f"```\n{json.dumps(data)}\n```"
        result = TripleExtractor._parse_json(text)
        assert result == data

    def test_embedded_array(self):
        data = [1, 2, 3]
        text = f"Some text before {json.dumps(data)} and after"
        result = TripleExtractor._parse_json(text)
        assert result == data

    def test_invalid_returns_none(self):
        result = TripleExtractor._parse_json("not json at all")
        assert result is None

    def test_empty_string(self):
        result = TripleExtractor._parse_json("")
        assert result is None

    def test_json_object(self):
        data = {"key": "value"}
        result = TripleExtractor._parse_json(json.dumps(data))
        assert result == data


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


class TestExtractEntities:
    """Tests for _extract_entities with mocked LLM."""

    @pytest.mark.asyncio
    async def test_valid_entity_list(self):
        extractor = TripleExtractor()
        llm_response = json.dumps([
            {"name": "Python", "type": "language"},
            {"name": "FastAPI", "type": "framework"},
        ])

        with (
            patch("app.services.triple_extractor.llm_service") as mock_llm,
            patch("app.services.graph_evolution.graph_evolution") as mock_ge,
        ):
            mock_ge.build_few_shot_ner_prompt.return_value = "system prompt"
            mock_llm.extraction_complete_simple = AsyncMock(return_value=llm_response)

            entities = await extractor._extract_entities("some text")

            assert len(entities) == 2
            assert entities[0].name == "Python"
            assert entities[0].entity_type == "language"
            assert entities[1].name == "FastAPI"

    @pytest.mark.asyncio
    async def test_string_list_format(self):
        extractor = TripleExtractor()
        llm_response = json.dumps(["Python", "FastAPI", "Docker"])

        with (
            patch("app.services.triple_extractor.llm_service") as mock_llm,
            patch("app.services.graph_evolution.graph_evolution") as mock_ge,
        ):
            mock_ge.build_few_shot_ner_prompt.return_value = "system prompt"
            mock_llm.extraction_complete_simple = AsyncMock(return_value=llm_response)

            entities = await extractor._extract_entities("some text")

            assert len(entities) == 3
            assert entities[0].name == "Python"
            assert entities[0].entity_type is None

    @pytest.mark.asyncio
    async def test_empty_llm_response(self):
        extractor = TripleExtractor()

        with (
            patch("app.services.triple_extractor.llm_service") as mock_llm,
            patch("app.services.graph_evolution.graph_evolution") as mock_ge,
        ):
            mock_ge.build_few_shot_ner_prompt.return_value = "system prompt"
            mock_llm.extraction_complete_simple = AsyncMock(return_value="")

            entities = await extractor._extract_entities("some text")
            assert entities == []

    @pytest.mark.asyncio
    async def test_malformed_json(self):
        extractor = TripleExtractor()

        with (
            patch("app.services.triple_extractor.llm_service") as mock_llm,
            patch("app.services.graph_evolution.graph_evolution") as mock_ge,
        ):
            mock_ge.build_few_shot_ner_prompt.return_value = "system prompt"
            mock_llm.extraction_complete_simple = AsyncMock(return_value="not json")

            entities = await extractor._extract_entities("some text")
            assert entities == []

    @pytest.mark.asyncio
    async def test_llm_exception(self):
        extractor = TripleExtractor()

        with (
            patch("app.services.triple_extractor.llm_service") as mock_llm,
            patch("app.services.graph_evolution.graph_evolution") as mock_ge,
        ):
            mock_ge.build_few_shot_ner_prompt.return_value = "system prompt"
            mock_llm.extraction_complete_simple = AsyncMock(side_effect=Exception("LLM error"))

            entities = await extractor._extract_entities("some text")
            assert entities == []


class TestExtractRelations:
    """Tests for _extract_relations with mocked LLM."""

    @pytest.mark.asyncio
    async def test_valid_triples(self):
        extractor = TripleExtractor()
        entities = [
            ExtractedEntity(name="Python"),
            ExtractedEntity(name="language"),
        ]
        llm_response = json.dumps([["Python", "is_a", "language"]])

        with (
            patch("app.services.triple_extractor.llm_service") as mock_llm,
            patch("app.services.graph_evolution.graph_evolution") as mock_ge,
        ):
            mock_ge.build_few_shot_re_prompt.return_value = "system prompt"
            mock_llm.extraction_complete_simple = AsyncMock(return_value=llm_response)

            triples = await extractor._extract_relations(entities, "some text")

            assert len(triples) == 1
            assert triples[0].head == "Python"
            assert triples[0].relation == "is_a"
            assert triples[0].tail == "language"

    @pytest.mark.asyncio
    async def test_skips_unknown_entities(self):
        extractor = TripleExtractor()
        entities = [ExtractedEntity(name="Python")]
        # Triple references "Java" which is not in entity list
        llm_response = json.dumps([["Python", "better_than", "Java"]])

        with (
            patch("app.services.triple_extractor.llm_service") as mock_llm,
            patch("app.services.graph_evolution.graph_evolution") as mock_ge,
        ):
            mock_ge.build_few_shot_re_prompt.return_value = "system prompt"
            mock_llm.extraction_complete_simple = AsyncMock(return_value=llm_response)

            triples = await extractor._extract_relations(entities, "some text")
            assert len(triples) == 0

    @pytest.mark.asyncio
    async def test_empty_llm_response(self):
        extractor = TripleExtractor()
        entities = [ExtractedEntity(name="Python")]

        with (
            patch("app.services.triple_extractor.llm_service") as mock_llm,
            patch("app.services.graph_evolution.graph_evolution") as mock_ge,
        ):
            mock_ge.build_few_shot_re_prompt.return_value = "system prompt"
            mock_llm.extraction_complete_simple = AsyncMock(return_value="")

            triples = await extractor._extract_relations(entities, "some text")
            assert triples == []


class TestExtract:
    """Tests for the top-level extract() method."""

    @pytest.mark.asyncio
    async def test_empty_entities_returns_empty(self):
        extractor = TripleExtractor()

        with patch.object(extractor, "_extract_entities", AsyncMock(return_value=[])):
            entities, triples = await extractor.extract("text", __import__("uuid").uuid4())
            assert entities == []
            assert triples == []
