import time
from collections import defaultdict
from typing import Annotated

from fastapi import Depends, HTTPException

from app.models.user import User
from app.utils.auth import get_current_user


class SlidingWindowRateLimiter:
    """In-memory sliding window rate limiter."""

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._windows: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, key: str) -> bool:
        now = time.monotonic()
        window = self._windows[key]
        cutoff = now - self.window_seconds
        while window and window[0] <= cutoff:
            window.pop(0)
        if len(window) >= self.max_requests:
            return False
        window.append(now)
        return True


# Two tiers
ai_limiter = SlidingWindowRateLimiter(max_requests=20, window_seconds=60)
rag_limiter = SlidingWindowRateLimiter(max_requests=10, window_seconds=60)


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

    async def __call__(self, user: Annotated[User, Depends(get_current_user)]):
        if not self.limiter.is_allowed(str(user.id)):
            raise HTTPException(
                status_code=429,
                detail=f"请求过于频繁，请稍后再试（限制：{self.limiter.max_requests}次/{self.limiter.window_seconds}秒）",
            )


# Pre-built dependency instances
ai_rate_limit = RateLimit(ai_limiter)
rag_rate_limit = RateLimit(rag_limiter)
