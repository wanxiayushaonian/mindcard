"""Unit tests for the pluggable rate-limit backends."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from app.utils import rate_limit


def _run(coro):
    return asyncio.run(coro)


# ── MemorySlidingWindow ───────────────────────────────────────────────


class TestMemorySlidingWindow:
    def test_allows_up_to_max_then_blocks(self):
        backend = rate_limit.MemorySlidingWindow()
        for _ in range(3):
            assert _run(backend.is_allowed("u1", 3, 60)) is True
        assert _run(backend.is_allowed("u1", 3, 60)) is False

    def test_window_slides_after_expiry(self):
        backend = rate_limit.MemorySlidingWindow()
        # Simulate 3 hits inside the window, then jump time forward past expiry.
        backend._windows["u1"] = [0.0, 1.0, 2.0]
        with patch.object(rate_limit.time, "monotonic", return_value=61.0):
            # Entries at 0 and 1 (<= cutoff 1) expire → only 2.0 remains → allowed
            assert _run(backend.is_allowed("u1", 2, 60)) is True

    def test_keys_are_independent(self):
        backend = rate_limit.MemorySlidingWindow()
        assert _run(backend.is_allowed("u1", 1, 60)) is True
        assert _run(backend.is_allowed("u1", 1, 60)) is False
        assert _run(backend.is_allowed("u2", 1, 60)) is True


# ── SlidingWindowRateLimiter wrapper ──────────────────────────────────


class TestWrapper:
    def test_delegates_with_binding_limits(self):
        backend = rate_limit.MemorySlidingWindow()
        limiter = rate_limit.SlidingWindowRateLimiter(backend, max_requests=2, window_seconds=60)
        assert _run(limiter.is_allowed("k")) is True
        assert _run(limiter.is_allowed("k")) is True
        assert _run(limiter.is_allowed("k")) is False


# ── RedisSlidingWindow ────────────────────────────────────────────────


class TestRedisSlidingWindow:
    def test_uses_lua_script_and_returns_allowed(self):
        fake_client = MagicMock()
        fake_script = AsyncMock(return_value=1)
        fake_client.register_script = MagicMock(return_value=fake_script)

        with patch("redis.asyncio.from_url", return_value=fake_client):
            backend = rate_limit.RedisSlidingWindow("redis://localhost:6379/0")
            assert _run(backend.is_allowed("u1", 10, 60)) is True

        fake_script.assert_awaited_once()
        call = fake_script.await_args
        assert call.kwargs["keys"] == ["rl:u1"]
        assert call.kwargs["args"][1:3] == [60, 10]  # window, max_req (now & member vary)

    def test_blocks_when_script_returns_zero(self):
        fake_client = MagicMock()
        fake_client.register_script = MagicMock(return_value=AsyncMock(return_value=0))

        with patch("redis.asyncio.from_url", return_value=fake_client):
            backend = rate_limit.RedisSlidingWindow("redis://localhost:6379/0")
            assert _run(backend.is_allowed("u1", 10, 60)) is False

    def test_falls_back_to_memory_when_redis_unreachable(self):
        with patch("redis.asyncio.from_url", side_effect=ConnectionError("no redis")):
            backend = rate_limit.RedisSlidingWindow("redis://localhost:6379/0")
            # Degrade to the in-memory fallback instead of raising
            assert _run(backend.is_allowed("u1", 10, 60)) is True
            assert _run(backend.is_allowed("u1", 10, 60)) is True

    def test_falls_back_to_memory_when_script_raises(self):
        fake_client = MagicMock()
        fake_client.register_script = MagicMock(
            return_value=AsyncMock(side_effect=RuntimeError("timeout"))
        )

        with patch("redis.asyncio.from_url", return_value=fake_client):
            backend = rate_limit.RedisSlidingWindow("redis://localhost:6379/0")
            assert _run(backend.is_allowed("u1", 10, 60)) is True


# ── Backend selection ─────────────────────────────────────────────────


class TestBackendSelection:
    def test_memory_default(self):
        backend = rate_limit._make_backend()
        assert isinstance(backend, rate_limit.MemorySlidingWindow)

    def test_redis_when_configured(self):
        with patch("app.utils.rate_limit.settings.rate_limit_backend", "redis"):
            with patch("app.utils.rate_limit.settings.redis_url", "redis://x/0"):
                backend = rate_limit._make_backend()
        assert isinstance(backend, rate_limit.RedisSlidingWindow)
