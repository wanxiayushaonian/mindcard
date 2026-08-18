"""Tests for the is_temp gate in _process_card().

Module-level imports inside _process_card() (app.models.card and
app.services.embedding) are isolated via sys.modules patching so the
test suite does not require a live Ollama instance or a fully-wired
SQLAlchemy engine.
"""
import sys
import uuid
from types import ModuleType
from unittest.mock import AsyncMock, MagicMock, patch

from tests.conftest import make_card


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_fake_embedding_module() -> tuple[ModuleType, MagicMock]:
    """Return (fake_module, mock_embedding_service) for sys.modules injection."""
    fake_mod = ModuleType("app.services.embedding")
    mock_svc = MagicMock()
    mock_svc.embed = AsyncMock(return_value=[0.1] * 1024)
    mock_svc.card_to_text = MagicMock(return_value="title content")
    fake_mod.embedding_service = mock_svc
    fake_mod.current_model_tag = MagicMock(return_value="test/bge-m3")
    return fake_mod, mock_svc


def _make_fake_card_module(card: MagicMock) -> ModuleType:
    """Return a fake app.models.card module whose Card sentinel resolves to *card*.

    models/__init__.py imports ``Card`` and ``CardRelation`` together, so the
    fake must mirror both exports or importing it triggers an ImportError when
    the app.models package is first initialized.
    """
    fake_mod = ModuleType("app.models.card")
    fake_mod.Card = object()  # only used as the key passed to db.get()
    fake_mod.CardRelation = object()
    return fake_mod


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_process_card_skips_temp(mock_db):
    """_process_card must exit early and never call embed when is_temp=True."""
    card = make_card(is_temp=True)

    async def _fake_get(model, pk):
        return card

    mock_db.get = _fake_get

    fake_emb_mod, mock_svc = _make_fake_embedding_module()
    fake_card_mod = _make_fake_card_module(card)

    extra_sys = {
        "app.models.card": fake_card_mod,
        "app.services.embedding": fake_emb_mod,
    }

    with patch.dict(sys.modules, extra_sys):
        with patch("app.database.async_session") as mock_session_ctx:
            mock_session_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_db)
            mock_session_ctx.return_value.__aexit__ = AsyncMock(return_value=False)

            # Re-import after sys.modules is patched so the local imports inside
            # _process_card() resolve to our fakes.
            import importlib
            import app.utils.card_tasks as ct_module
            importlib.reload(ct_module)

            await ct_module._process_card(uuid.uuid4())

    mock_svc.embed.assert_not_called()


async def test_process_card_runs_pipeline_when_not_temp(mock_db):
    """_process_card must call embed when is_temp=False.

    Steps after embedding (topic, topology, triple extraction) are also
    mocked so the test is fully self-contained.  If embed is invoked the
    gate is working correctly; subsequent failures are irrelevant here.
    """
    card = make_card(is_temp=False)

    async def _fake_get(model, pk):
        return card

    mock_db.get = _fake_get
    mock_db.commit = AsyncMock()

    fake_emb_mod, mock_svc = _make_fake_embedding_module()
    fake_card_mod = _make_fake_card_module(card)

    # Downstream services — mock them so the test does not need live LLM/DB.
    fake_topic_svc = MagicMock()
    fake_topic_svc.assign_card_to_topic = AsyncMock()
    fake_topic_mod = ModuleType("app.services.topic")
    fake_topic_mod.topic_service = fake_topic_svc

    fake_topo_svc = MagicMock()
    fake_topo_svc.assign_card_to_node = AsyncMock()
    fake_topo_mod = ModuleType("app.services.topology")
    fake_topo_mod.topology_service = fake_topo_svc

    fake_triple_extractor = MagicMock()
    fake_triple_extractor.extract = AsyncMock(return_value=([], []))
    fake_triple_mod = ModuleType("app.services.triple_extractor")
    fake_triple_mod.triple_extractor = fake_triple_extractor

    fake_entity_linker_mod = ModuleType("app.services.entity_linker")
    fake_entity_linker_mod.EntityLinker = MagicMock()

    extra_sys = {
        "app.models.card": fake_card_mod,
        "app.services.embedding": fake_emb_mod,
        "app.services.topic": fake_topic_mod,
        "app.services.topology": fake_topo_mod,
        "app.services.triple_extractor": fake_triple_mod,
        "app.services.entity_linker": fake_entity_linker_mod,
    }

    with patch.dict(sys.modules, extra_sys):
        with patch("app.database.async_session") as mock_session_ctx:
            mock_session_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_db)
            mock_session_ctx.return_value.__aexit__ = AsyncMock(return_value=False)

            import importlib
            import app.utils.card_tasks as ct_module
            importlib.reload(ct_module)

            await ct_module._process_card(uuid.uuid4())

    mock_svc.embed.assert_called_once()
