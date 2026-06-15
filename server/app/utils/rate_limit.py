import time
from collections import defaultdict
from typing import Annotated

from fastapi import Depends, HTTPException, Request

from app.config import settings
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
        if not window:
            del self._windows[key]
            window = self._windows[key]
        if len(window) >= self.max_requests:
            return False
        window.append(now)
        return True


# Three tiers — configured via settings
auth_limiter = SlidingWindowRateLimiter(
    max_requests=settings.rate_limit_auth_max,
    window_seconds=settings.rate_limit_auth_window,
)
ai_limiter = SlidingWindowRateLimiter(
    max_requests=settings.rate_limit_ai_max,
    window_seconds=settings.rate_limit_ai_window,
)
rag_limiter = SlidingWindowRateLimiter(
    max_requests=settings.rate_limit_rag_max,
    window_seconds=settings.rate_limit_rag_window,
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

    async def __call__(self, user: Annotated[User, Depends(get_current_user)]):
        if not self.limiter.is_allowed(str(user.id)):
            raise HTTPException(
                status_code=429,
                detail=f"Too many requests ({self.limiter.max_requests}/{self.limiter.window_seconds}s)",
            )


class RateLimitByIP:
    """FastAPI dependency class that rate-limits by client IP (for unauthenticated endpoints).

    Usage:
        @router.post("/login")
        async def login(_rl: None = Depends(RateLimitByIP(auth_limiter))):
            ...
    """

    def __init__(self, limiter: SlidingWindowRateLimiter):
        self.limiter = limiter

    async def __call__(self, request: Request):
        client_ip = request.client.host if request.client else "unknown"
        if not self.limiter.is_allowed(client_ip):
            raise HTTPException(
                status_code=429,
                detail=f"Too many requests ({self.limiter.max_requests}/{self.limiter.window_seconds}s)",
            )


# Pre-built dependency instances
auth_rate_limit = RateLimitByIP(auth_limiter)
ai_rate_limit = RateLimit(ai_limiter)
rag_rate_limit = RateLimit(rag_limiter)
