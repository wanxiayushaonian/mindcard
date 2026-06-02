"""Tests for RetrievalDispatcher service."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas.retrieval import EntityContext, RetrievalLevel, RetrievalResult
from app.services.retrieval_dispatcher import RetrievalDispatcher


@pytest.fixture
def dispatcher():
    return RetrievalDispatcher()


@pytest.fixture
def mock_db():
    return AsyncMock()


@pytest.fixture
def workspace_ids():
    return [uuid.uuid4()]


# ---------------------------------------------------------------------------
# RetrievalLevel enum
# ---------------------------------------------------------------------------


class TestRetrievalLevel:
    def test_values(self):
        assert RetrievalLevel.FREE == 0
        assert RetrievalLevel.CARD == 1
        assert RetrievalLevel.GRAPH == 2
        assert RetrievalLevel.FULL == 3

    def test_int_conversion(self):
        assert RetrievalLevel(0) is RetrievalLevel.FREE
        assert RetrievalLevel(1) is RetrievalLevel.CARD
        assert RetrievalLevel(2) is RetrievalLevel.GRAPH
        assert RetrievalLevel(3) is RetrievalLevel.FULL

    def test_membership(self):
        assert RetrievalLevel.FREE in RetrievalLevel
        assert RetrievalLevel.FULL in RetrievalLevel


# ---------------------------------------------------------------------------
# RetrievalResult dataclass
# ---------------------------------------------------------------------------


class TestRetrievalResult:
    def test_default_values(self):
        result = RetrievalResult()
        assert result.cards == []
        assert result.card_scores == []
        assert result.entities == []
        assert result.topology_path is None
        assert result.node_card_titles == []
        assert result.cross_refs == []
        assert result.level_used == RetrievalLevel.FREE

    def test_construction_with_all_fields(self):
        entity = EntityContext(entity_id="e1", name="Test")
        result = RetrievalResult(
            cards=["card1"],
            card_scores=[0.9],
            entities=[entity],
            topology_path=[{"node_id": "n1", "title": "Root", "summary": ""}],
            node_card_titles=["Title A"],
            cross_refs=[{"target_title": "Branch", "ref_type": "related", "reason": "test"}],
            level_used=RetrievalLevel.FULL,
        )
        assert result.level_used == RetrievalLevel.FULL
        assert len(result.cards) == 1
        assert len(result.entities) == 1
        assert result.entities[0].name == "Test"
        assert result.topology_path is not None
        assert len(result.topology_path) == 1


# ---------------------------------------------------------------------------
# EntityContext dataclass
# ---------------------------------------------------------------------------


class TestEntityContext:
    def test_defaults(self):
        ctx = EntityContext(entity_id="1", name="Foo")
        assert ctx.entity_type is None
        assert ctx.relations == []
        assert ctx.linked_card_titles == []

    def test_with_relations(self):
        ctx = EntityContext(
            entity_id="1",
            name="Foo",
            entity_type="concept",
            relations=[{"head_name": "A", "relation": "is_a", "tail_name": "B", "weight": 0.8}],
            linked_card_titles=["Card 1"],
        )
        assert len(ctx.relations) == 1
        assert ctx.relations[0]["relation"] == "is_a"


# ---------------------------------------------------------------------------
# detect_level
# ---------------------------------------------------------------------------


class TestDetectLevel:
    @pytest.mark.asyncio
    async def test_short_question_returns_card(self, dispatcher, mock_db, workspace_ids):
        """Questions shorter than 10 chars return CARD."""
        result = await dispatcher.detect_level("short", workspace_ids, mock_db)
        assert result == RetrievalLevel.CARD

    @pytest.mark.asyncio
    async def test_short_question_exactly_nine_chars(self, dispatcher, mock_db, workspace_ids):
        """Exactly 9 chars still triggers the short-question path."""
        result = await dispatcher.detect_level("nine char", workspace_ids, mock_db)
        assert result == RetrievalLevel.CARD

    @pytest.mark.asyncio
    async def test_entity_name_in_question_returns_graph(
        self, dispatcher, mock_db, workspace_ids
    ):
        """When the best entity name is found as a substring of the question, returns GRAPH."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = "Transformer"
        mock_db.execute.return_value = mock_result

        with patch("app.services.embedding.embedding_service") as mock_emb:
            mock_emb.embed = AsyncMock(return_value=[0.1] * 10)
            result = await dispatcher.detect_level(
                "explain the Transformer architecture in detail", workspace_ids, mock_db
            )
        assert result == RetrievalLevel.GRAPH

    @pytest.mark.asyncio
    async def test_deep_keyword_analysis_returns_full(
        self, dispatcher, mock_db, workspace_ids
    ):
        """Deep analysis keyword '分析' triggers FULL level."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        with patch("app.services.embedding.embedding_service") as mock_emb:
            mock_emb.embed = AsyncMock(return_value=[0.1] * 10)
            result = await dispatcher.detect_level(
                "请分析一下这个模型的性能", workspace_ids, mock_db
            )
        assert result == RetrievalLevel.FULL

    @pytest.mark.asyncio
    async def test_deep_keyword_contrast_returns_full(
        self, dispatcher, mock_db, workspace_ids
    ):
        """Deep analysis keyword '对比' triggers FULL level."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        with patch("app.services.embedding.embedding_service") as mock_emb:
            mock_emb.embed = AsyncMock(return_value=[0.1] * 10)
            result = await dispatcher.detect_level(
                "对比两个算法的性能表现差异", workspace_ids, mock_db
            )
        assert result == RetrievalLevel.FULL

    @pytest.mark.asyncio
    async def test_no_entity_no_keyword_returns_graph(
        self, dispatcher, mock_db, workspace_ids
    ):
        """Long question without entities or deep keywords returns GRAPH."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        with patch("app.services.embedding.embedding_service") as mock_emb:
            mock_emb.embed = AsyncMock(return_value=[0.1] * 10)
            result = await dispatcher.detect_level(
                "how does backpropagation work in neural networks", workspace_ids, mock_db
            )
        assert result == RetrievalLevel.GRAPH

    @pytest.mark.asyncio
    async def test_embedding_failure_falls_through_to_keyword_check(
        self, dispatcher, mock_db, workspace_ids
    ):
        """When embedding fails, falls through to keyword detection."""
        with patch("app.services.embedding.embedding_service") as mock_emb:
            mock_emb.embed = AsyncMock(side_effect=RuntimeError("embedding down"))
            result = await dispatcher.detect_level(
                "请分析这个数据的趋势变化", workspace_ids, mock_db
            )
        assert result == RetrievalLevel.FULL

    @pytest.mark.asyncio
    async def test_embedding_failure_no_keyword_returns_graph(
        self, dispatcher, mock_db, workspace_ids
    ):
        """When embedding fails and no keywords, returns GRAPH for long questions."""
        with patch("app.services.embedding.embedding_service") as mock_emb:
            mock_emb.embed = AsyncMock(side_effect=RuntimeError("embedding down"))
            result = await dispatcher.detect_level(
                "how does gradient descent optimize loss functions", workspace_ids, mock_db
            )
        assert result == RetrievalLevel.GRAPH

    @pytest.mark.asyncio
    async def test_empty_workspace_ids_skips_entity_check(
        self, dispatcher, mock_db
        ):
        """When workspace_ids is empty, entity detection is skipped."""
        result = await dispatcher.detect_level(
            "how does gradient descent optimize loss functions", [], mock_db
        )
        # No entity check, no keywords, long question → GRAPH
        assert result == RetrievalLevel.GRAPH


# ---------------------------------------------------------------------------
# build_entity_context_string (static)
# ---------------------------------------------------------------------------


class TestBuildEntityContextString:
    def test_empty_entities_returns_empty_string(self):
        result = RetrievalResult(entities=[])
        assert RetrievalDispatcher.build_entity_context_string(result) == ""

    def test_entity_with_relations(self):
        ctx = EntityContext(
            entity_id="1",
            name="Neural Network",
            entity_type="concept",
            relations=[
                {"head_name": "Neural Network", "relation": "uses", "tail_name": "Backpropagation", "weight": 0.9},
            ],
            linked_card_titles=["Deep Learning Intro"],
        )
        result = RetrievalResult(entities=[ctx])
        output = RetrievalDispatcher.build_entity_context_string(result)

        assert "Neural Network" in output
        assert "Backpropagation" in output
        assert "uses" in output
        assert "Deep Learning Intro" in output
        assert "关联卡片" in output

    def test_entity_without_relations(self):
        ctx = EntityContext(
            entity_id="2",
            name="Attention",
            entity_type="mechanism",
        )
        result = RetrievalResult(entities=[ctx])
        output = RetrievalDispatcher.build_entity_context_string(result)

        # Should have the header but no relation lines
        assert "知识库中的相关概念" in output
        assert "Attention" not in output  # no relations, no card titles → no detail lines

    def test_multiple_entities(self):
        ctx1 = EntityContext(
            entity_id="1",
            name="CNN",
            relations=[
                {"head_name": "CNN", "relation": "is_a", "tail_name": "Neural Network", "weight": 1.0},
            ],
        )
        ctx2 = EntityContext(
            entity_id="2",
            name="RNN",
            relations=[
                {"head_name": "RNN", "relation": "is_a", "tail_name": "Neural Network", "weight": 1.0},
            ],
        )
        result = RetrievalResult(entities=[ctx1, ctx2])
        output = RetrievalDispatcher.build_entity_context_string(result)

        assert "CNN" in output
        assert "RNN" in output

    def test_relations_limited_to_three(self):
        relations = [
            {"head_name": "A", "relation": f"rel_{i}", "tail_name": "B", "weight": 0.5}
            for i in range(5)
        ]
        ctx = EntityContext(entity_id="1", name="Test", relations=relations)
        result = RetrievalResult(entities=[ctx])
        output = RetrievalDispatcher.build_entity_context_string(result)

        # Only first 3 relations should appear
        assert "rel_0" in output
        assert "rel_2" in output
        assert "rel_3" not in output


# ---------------------------------------------------------------------------
# build_topology_context_string (static)
# ---------------------------------------------------------------------------


class TestBuildTopologyContextString:
    def test_no_topology_returns_empty(self):
        result = RetrievalResult()
        assert RetrievalDispatcher.build_topology_context_string(result) == ""

    def test_with_topology_path(self):
        result = RetrievalResult(
            topology_path=[
                {"node_id": "1", "title": "Machine Learning", "summary": "Root topic"},
                {"node_id": "2", "title": "Deep Learning", "summary": "Subtopic"},
            ],
        )
        output = RetrievalDispatcher.build_topology_context_string(result)

        assert "Machine Learning" in output
        assert "Deep Learning" in output
        assert "探索路径" in output
        assert "→" in output

    def test_with_node_card_titles(self):
        result = RetrievalResult(
            node_card_titles=["Card A", "Card B"],
        )
        output = RetrievalDispatcher.build_topology_context_string(result)

        assert "Card A" in output
        assert "Card B" in output
        assert "积累的知识" in output

    def test_with_cross_refs(self):
        result = RetrievalResult(
            cross_refs=[
                {"target_title": "Related Branch", "ref_type": "related", "reason": "overlap"},
            ],
        )
        output = RetrievalDispatcher.build_topology_context_string(result)

        assert "Related Branch" in output
        assert "related" in output
        assert "相关分支" in output

    def test_full_topology_output(self):
        """All topology fields combined."""
        result = RetrievalResult(
            topology_path=[
                {"node_id": "1", "title": "AI", "summary": ""},
                {"node_id": "2", "title": "NLP", "summary": ""},
            ],
            node_card_titles=["Transformer Paper", "BERT Notes"],
            cross_refs=[
                {"target_title": "CV Branch", "ref_type": "cross", "reason": "shared backbone"},
            ],
        )
        output = RetrievalDispatcher.build_topology_context_string(result)

        assert "AI → NLP" in output
        assert "Transformer Paper" in output
        assert "CV Branch" in output

    def test_topology_path_titles_filtered(self):
        """Empty titles are filtered out of the path string."""
        result = RetrievalResult(
            topology_path=[
                {"node_id": "1", "title": "", "summary": ""},
                {"node_id": "2", "title": "NLP", "summary": ""},
            ],
        )
        output = RetrievalDispatcher.build_topology_context_string(result)
        assert "NLP" in output

    def test_cross_refs_limited_to_three(self):
        refs = [
            {"target_title": f"Branch {i}", "ref_type": "cross", "reason": ""}
            for i in range(5)
        ]
        result = RetrievalResult(cross_refs=refs)
        output = RetrievalDispatcher.build_topology_context_string(result)

        assert "Branch 0" in output
        assert "Branch 2" in output
        assert "Branch 3" not in output


# ---------------------------------------------------------------------------
# dispatch routing
# ---------------------------------------------------------------------------


class TestDispatch:
    @pytest.mark.asyncio
    async def test_free_level_returns_empty(self, dispatcher, mock_db, workspace_ids):
        result = await dispatcher.dispatch(
            question="test", level=RetrievalLevel.FREE,
            workspace_ids=workspace_ids, db=mock_db,
        )
        assert result.level_used == RetrievalLevel.FREE
        assert result.cards == []
        assert result.entities == []

    @pytest.mark.asyncio
    async def test_int_level_is_converted(self, dispatcher, mock_db, workspace_ids):
        """Passing an int level should be converted to RetrievalLevel."""
        result = await dispatcher.dispatch(
            question="test", level=0,
            workspace_ids=workspace_ids, db=mock_db,
        )
        assert result.level_used == RetrievalLevel.FREE

    @pytest.mark.asyncio
    async def test_auto_level_with_short_question(self, dispatcher, mock_db, workspace_ids):
        """AUTO_LEVEL (-1) with a short question triggers detect_level -> CARD."""
        mock_card_result = RetrievalResult(
            cards=[], card_scores=[], level_used=RetrievalLevel.CARD
        )
        with patch.object(
            dispatcher, "_level_card", new_callable=AsyncMock, return_value=mock_card_result
        ):
            result = await dispatcher.dispatch(
                question="hi", level=RetrievalDispatcher.AUTO_LEVEL,
                workspace_ids=workspace_ids, db=mock_db,
            )
        assert result.level_used == RetrievalLevel.CARD

    @pytest.mark.asyncio
    async def test_card_level_calls_level_card(self, dispatcher, mock_db, workspace_ids):
        """CARD level routes to _level_card."""
        mock_card_result = RetrievalResult(
            cards=["c1"], card_scores=[0.5], level_used=RetrievalLevel.CARD
        )
        with patch.object(
            dispatcher, "_level_card", new_callable=AsyncMock, return_value=mock_card_result
        ) as mock_lc:
            result = await dispatcher.dispatch(
                question="test", level=RetrievalLevel.CARD,
                workspace_ids=workspace_ids, db=mock_db,
            )
            mock_lc.assert_awaited_once()
            assert result.level_used == RetrievalLevel.CARD

    @pytest.mark.asyncio
    async def test_graph_level_calls_level_graph(self, dispatcher, mock_db, workspace_ids):
        """GRAPH level routes to _level_graph."""
        mock_graph_result = RetrievalResult(
            cards=["c1"], entities=[], level_used=RetrievalLevel.GRAPH
        )
        with patch.object(
            dispatcher, "_level_graph", new_callable=AsyncMock, return_value=mock_graph_result
        ) as mock_lg:
            result = await dispatcher.dispatch(
                question="test", level=RetrievalLevel.GRAPH,
                workspace_ids=workspace_ids, db=mock_db,
            )
            mock_lg.assert_awaited_once()
            assert result.level_used == RetrievalLevel.GRAPH

    @pytest.mark.asyncio
    async def test_full_level_calls_level_full(self, dispatcher, mock_db, workspace_ids):
        """FULL level routes to _level_full."""
        mock_full_result = RetrievalResult(
            cards=[], entities=[], level_used=RetrievalLevel.FULL
        )
        with patch.object(
            dispatcher, "_level_full", new_callable=AsyncMock, return_value=mock_full_result
        ):
            result = await dispatcher.dispatch(
                question="test", level=RetrievalLevel.FULL,
                workspace_ids=workspace_ids, db=mock_db, chat_id=None,
            )
            assert result.level_used == RetrievalLevel.FULL

    @pytest.mark.asyncio
    async def test_full_level_with_chat_id_injects_topology(
        self, dispatcher, mock_db, workspace_ids
    ):
        """FULL level + chat_id triggers get_topology_context injection."""
        mock_full_result = RetrievalResult(
            cards=[], entities=[], level_used=RetrievalLevel.FULL
        )
        topo_data = {
            "path": [{"node_id": "n1", "title": "Root", "summary": ""}],
            "node_card_titles": ["Card X"],
            "cross_refs": [],
        }
        with patch.object(
            dispatcher, "_level_full", new_callable=AsyncMock, return_value=mock_full_result
        ), patch.object(
            dispatcher, "get_topology_context", new_callable=AsyncMock, return_value=topo_data
        ):
            result = await dispatcher.dispatch(
                question="test", level=RetrievalLevel.FULL,
                workspace_ids=workspace_ids, db=mock_db,
                chat_id="chat-123",
            )
            assert result.topology_path == topo_data["path"]
            assert result.node_card_titles == topo_data["node_card_titles"]
            assert result.cross_refs == topo_data["cross_refs"]
