"""Rate limiting with pluggable backends.

Backends:
- ``MemorySlidingWindow`` — per-process sliding window (default, zero deps).
- ``RedisSlidingWindow`` — distributed sliding window shared across workers,
  selected via ``RATE_LIMIT_BACKEND=redis``. Falls back to memory if Redis is
  unreachable so the API never 5xxs because of a rate-limiter outage.

The ``SlidingWindowRateLimiter`` wrapper binds a backend to per-endpoint
limits (``max_requests``/``window_seconds``) and exposes an async
``is_allowed(key)``.
"""

import logging
import time
from collections import defaultdict
from typing import Annotated, Any, Protocol

from fastapi import Depends, HTTPException, Request

from app.config import settings
from app.models.user import User
from app.utils.auth import get_current_user

logger = logging.getLogger(__name__)


class RateLimitBackend(Protocol):
    """Async rate-limit backend interface."""

    async def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> bool:
        """Return True if key may proceed, otherwise False (limited)."""


class MemorySlidingWindow:
    """In-memory sliding window. Counters are per-process, so N workers each
    get their own budget — this is the default for single-worker setups."""

    def __init__(self) -> None:
        self._windows: dict[str, list[float]] = defaultdict(list)

    async def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> bool:
        now = time.monotonic()
        window = self._windows[key]
        cutoff = now - window_seconds
        while window and window[0] <= cutoff:
            window.pop(0)
        if not window:
            del self._windows[key]
            window = self._windows[key]
        if len(window) >= max_requests:
            return False
        window.append(now)
        return True


# Atomic sliding-window check-and-add. Returns 1 (allowed) or 0 (limited).
_WINDOW_LUA = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max_req = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= max_req then
    return 0
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, window)
return 1
"""


class RedisSlidingWindow:
    """Distributed sliding window backed by a Redis sorted set.

    Each request appends a timestamp-scored member; expired entries are
    pruned and the cardinality checked atomically in one Lua script. The
    window is shared across all workers, so multi-process deployments get
    one global budget instead of N independent ones.

    If Redis is unavailable the limiter degrades to ``MemorySlidingWindow``
    (fail-open for the limiter, never fail-closed for the whole API).
    """

    def __init__(self, redis_url: str) -> None:
        self._redis_url = redis_url
        self._client: Any = None  # lazily created redis.asyncio.Redis
        self._script: Any = None  # lazily registered Lua script
        self._fallback = MemorySlidingWindow()
        self._seq = 0

    def _get_client(self) -> Any:
        if self._client is None:
            import redis.asyncio as redis_async

            self._client = redis_async.from_url(self._redis_url, decode_responses=True)
            self._script = self._client.register_script(_WINDOW_LUA)
        return self._client

    async def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> bool:
        now = time.monotonic()
        self._seq = (self._seq + 1) % 1_000_000
        member = f"{now}:{self._seq}"
        try:
            self._get_client()
            assert self._script is not None
            allowed = await self._script(
                keys=[f"rl:{key}"],
                args=[now, window_seconds, max_requests, member],
            )
            return bool(allowed)
        except Exception as e:  # Redis down / timeout — degrade gracefully
            logger.warning("Redis rate limit unavailable, using memory: %s", e)
            return await self._fallback.is_allowed(key, max_requests, window_seconds)


def _make_backend() -> RateLimitBackend:
    if settings.rate_limit_backend.strip().lower() == "redis":
        return RedisSlidingWindow(settings.redis_url)
    return MemorySlidingWindow()


# One shared backend instance for all limiters (Redis client connection reused).
_rate_limit_backend = _make_backend()


class SlidingWindowRateLimiter:
    """Rate limiter bound to a backend plus per-endpoint limits."""

    def __init__(self, backend: RateLimitBackend, max_requests: int, window_seconds: int):
        self._backend = backend
        self.max_requests = max_requests
        self.window_seconds = window_seconds

    async def is_allowed(self, key: str) -> bool:
        return await self._backend.is_allowed(key, self.max_requests, self.window_seconds)


# Four tiers — configured via settings
auth_limiter = SlidingWindowRateLimiter(
    _rate_limit_backend,
    max_requests=settings.rate_limit_auth_max,
    window_seconds=settings.rate_limit_auth_window,
)
ai_limiter = SlidingWindowRateLimiter(
    _rate_limit_backend,
    max_requests=settings.rate_limit_ai_max,
    window_seconds=settings.rate_limit_ai_window,
)
rag_limiter = SlidingWindowRateLimiter(
    _rate_limit_backend,
    max_requests=settings.rate_limit_rag_max,
    window_seconds=settings.rate_limit_rag_window,
)
ws_limiter = SlidingWindowRateLimiter(
    _rate_limit_backend,
    max_requests=settings.rate_limit_ws_max,
    window_seconds=settings.rate_limit_ws_window,
)


class RateLimit:
    """FastAPI dependency class that rate-limits by authenticated user.

    Usage:
        @router.post("/endpoint")
        async def endpoint(user: User = Depends(get_current_user),
                           _rl: None = Depends(RateLimit(ai_limiter))):
            ...
    """

    def __init__(self, limiter: SlidingWindowRateLimiter):
        self.limiter = limiter

    async def __call__(self, user: Annotated[User, Depends(get_current_user)]) -> None:
        if not await self.limiter.is_allowed(str(user.id)):
            detail = (
                f"Too many requests ({self.limiter.max_requests}/"
                f"{self.limiter.window_seconds}s)"
            )
            raise HTTPException(status_code=429, detail=detail)


class RateLimitByIP:
    """FastAPI dependency class that rate-limits by client IP (for unauthenticated endpoints).

    Usage:
        @router.post("/login")
        async def login(_rl: None = Depends(RateLimitByIP(auth_limiter))):
            ...
    """

    def __init__(self, limiter: SlidingWindowRateLimiter):
        self.limiter = limiter

    async def __call__(self, request: Request) -> None:
        client_ip = request.client.host if request.client else "unknown"
        if not await self.limiter.is_allowed(client_ip):
            detail = (
                f"Too many requests ({self.limiter.max_requests}/"
                f"{self.limiter.window_seconds}s)"
            )
            raise HTTPException(status_code=429, detail=detail)


# Pre-built dependency instances
auth_rate_limit = RateLimitByIP(auth_limiter)
ai_rate_limit = RateLimit(ai_limiter)
rag_rate_limit = RateLimit(rag_limiter)
