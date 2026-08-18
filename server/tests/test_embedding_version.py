"""Unit tests for embedding model version tagging."""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.embedding import check_embedding_consistency, current_model_tag


class TestCurrentModelTag:
    def test_returns_provider_and_model(self):
        with patch("app.config.settings.embedding_provider", " openai "):
            with patch("app.config.settings.embedding_model", "BAAI/bge-m3"):
                assert current_model_tag() == "openai/BAAI/bge-m3"

    def test_default_ollama(self):
        with patch("app.config.settings.embedding_provider", "ollama"):
            with patch("app.config.settings.embedding_model", "bge-m3"):
                assert current_model_tag() == "ollama/bge-m3"


class TestConsistencyCheck:
    def _patch_db(self, db: AsyncMock):
        session = AsyncMock()
        session.__aenter__.return_value = db
        return patch("app.database.async_session", return_value=session)

    def _result(self, rows: list[tuple]):
        r = MagicMock()
        r.all.return_value = rows
        return r

    async def test_matching_model_is_quiet(self, caplog):
        db = AsyncMock()
        db.execute = AsyncMock(
            return_value=self._result([("openai/BAAI/bge-m3", 42)])
        )
        with patch("app.config.settings.embedding_provider", "openai"):
            with patch("app.config.settings.embedding_model", "BAAI/bge-m3"):
                with self._patch_db(db):
                    dominant = await check_embedding_consistency()

        assert dominant == "openai/BAAI/bge-m3"
        assert "drift" not in caplog.text

    async def test_drift_logs_warning(self, caplog):
        db = AsyncMock()
        db.execute = AsyncMock(
            return_value=self._result([("ollama/bge-m3", 42)])
        )
        with patch("app.config.settings.embedding_provider", "openai"):
            with patch("app.config.settings.embedding_model", "BAAI/bge-m3"):
                with self._patch_db(db):
                    dominant = await check_embedding_consistency()

        assert dominant == "ollama/bge-m3"
        assert "drift" in caplog.text

    async def test_unversioned_vectors_are_reported(self, caplog):
        db = AsyncMock()
        db.execute = AsyncMock(return_value=self._result([(None, 42)]))
        with self._patch_db(db):
            with caplog.at_level(logging.INFO, logger="app.services.embedding"):
                dominant = await check_embedding_consistency()

        assert dominant is None
        assert "predate" in caplog.text

    async def test_empty_db_returns_none(self, caplog):
        db = AsyncMock()
        db.execute = AsyncMock(return_value=self._result([]))
        with self._patch_db(db):
            assert await check_embedding_consistency() is None

        assert caplog.text == ""
