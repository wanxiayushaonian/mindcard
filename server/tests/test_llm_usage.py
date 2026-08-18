"""Unit tests for LLM token usage tracking and daily quota enforcement."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.tools.base import ChatResponse
from app.utils import usage as usage_mod
from app.utils.usage import estimate_tokens, llm_quota_guard, persist_usage


class TestEstimateTokens:
    def test_estimates_from_lengths(self):
        messages = [{"role": "user", "content": "你好" * 30}]
        est = estimate_tokens(messages, output_text="回复" * 30)
        assert est["input_tokens"] > 0
        assert est["output_tokens"] > 0
        assert est["total_tokens"] == est["input_tokens"] + est["output_tokens"]

    def test_empty_inputs(self):
        assert estimate_tokens([], "")["total_tokens"] == 0


class TestPersistUsage:
    def _patch_db(self, db: AsyncMock):
        session = AsyncMock()
        session.__aenter__.return_value = db
        return patch("app.database.async_session", return_value=session)

    async def test_skips_when_no_usage(self):
        db = AsyncMock()
        with self._patch_db(db):
            await persist_usage(str(uuid.uuid4()), None)
        db.execute.assert_not_called()

    async def test_upserts_totals(self):
        db = AsyncMock()
        db.execute = AsyncMock()
        db.commit = AsyncMock()
        uid = str(uuid.uuid4())

        with self._patch_db(db):
            await persist_usage(uid, {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30})

        db.execute.assert_awaited_once()
        assert db.commit.await_count == 1

    async def test_never_raises_on_db_error(self):
        db = AsyncMock()
        db.execute = AsyncMock(side_effect=RuntimeError("db down"))
        uid = str(uuid.uuid4())

        with self._patch_db(db):
            await persist_usage(uid, {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2})

        # Silently tolerated — accounting must not break the request path.


class TestQuotaGuard:
    async def test_disabled_when_quota_zero(self):
        user = MagicMock()
        user.id = uuid.uuid4()
        with patch("app.utils.usage.settings.llm_daily_quota_tokens", 0):
            with patch("app.utils.usage.get_daily_total", new=AsyncMock()) as getter:
                await llm_quota_guard(user)
        getter.assert_not_awaited()

    async def test_allows_below_quota(self):
        user = MagicMock()
        user.id = uuid.uuid4()
        with patch("app.utils.usage.settings.llm_daily_quota_tokens", 1000):
            with patch("app.utils.usage.get_daily_total", new=AsyncMock(return_value=500)):
                await llm_quota_guard(user)

    async def test_rejects_when_exhausted(self):
        user = MagicMock()
        user.id = uuid.uuid4()
        with patch("app.utils.usage.settings.llm_daily_quota_tokens", 1000):
            with patch("app.utils.usage.get_daily_total", new=AsyncMock(return_value=1000)):
                with pytest.raises(HTTPException) as exc:
                    await llm_quota_guard(user)
        assert exc.value.status_code == 429


class TestContextVar:
    def test_set_and_get(self):
        assert usage_mod.get_current_user_id() is None
        usage_mod.set_current_user_id("user-1")
        assert usage_mod.get_current_user_id() == "user-1"
        usage_mod.set_current_user_id(None)
        assert usage_mod.get_current_user_id() is None


class TestChatResponseUsage:
    def test_usage_field_defaults_none(self):
        assert ChatResponse().usage is None

    def test_usage_field_accepts_dict(self):
        usage = {"input_tokens": 1, "output_tokens": 2, "total_tokens": 3}
        resp = ChatResponse(content="hi", usage=usage)
        assert resp.usage["total_tokens"] == 3
