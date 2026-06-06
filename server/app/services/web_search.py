"""Web search service with multiple provider support.

Supported providers:
- DuckDuckGo (default, no API key needed)
- Brave Search (API key required)
- Tavily (API key required)
- SearXNG (self-hosted, base_url required)
- Jina (API key required)
- Kagi (API key required)
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass
from urllib.parse import quote

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 300  # 5 minutes
CACHE_MAX_SIZE = 256

PROVIDER_META = [
    {"name": "duckduckgo", "label": "DuckDuckGo", "credential": "none"},
    {"name": "brave", "label": "Brave Search", "credential": "api_key"},
    {"name": "tavily", "label": "Tavily", "credential": "api_key"},
    {"name": "searxng", "label": "SearXNG", "credential": "base_url"},
    {"name": "jina", "label": "Jina", "credential": "api_key"},
    {"name": "kagi", "label": "Kagi", "credential": "api_key"},
]


@dataclass
class SearchResult:
    title: str
    snippet: str
    url: str


def _resolve_api_key(provider: str) -> str:
    """Resolve API key from settings or environment."""
    key = settings.web_search_api_key
    if key:
        return key
    env_map = {
        "brave": "BRAVE_API_KEY",
        "tavily": "TAVILY_API_KEY",
        "jina": "JINA_API_KEY",
        "kagi": "KAGI_API_KEY",
    }
    return os.environ.get(env_map.get(provider, ""), "")


def _resolve_base_url() -> str:
    """Resolve SearXNG base URL from settings or environment."""
    url = settings.web_search_base_url
    if url:
        return url
    return os.environ.get("SEARXNG_BASE_URL", "")


_proxy_cache: tuple[float, str | None] = (0.0, None)  # (timestamp, proxy_or_None)
_PROXY_CHECK_TTL = 60  # re-check every 60s


def _check_proxy_alive(proxy: str) -> bool:
    """Quick TCP check: can we connect to the proxy host:port within 2s?"""
    from urllib.parse import urlparse
    try:
        p = urlparse(proxy)
        host = p.hostname or "127.0.0.1"
        port = p.port or (1080 if p.scheme.startswith("socks") else 8080)
        import socket
        with socket.create_connection((host, port), timeout=2.0):
            return True
    except Exception:
        return False


def _resolve_proxy() -> str | None:
    """Resolve proxy from settings or environment, with availability check.

    Returns the proxy URL if configured AND reachable, else None.
    Caches the check result for 60 seconds.
    """
    global _proxy_cache
    proxy = settings.web_search_proxy
    if not proxy:
        for var in ("ALL_PROXY", "HTTPS_PROXY", "HTTP_PROXY"):
            val = os.environ.get(var, "")
            if val:
                proxy = val
                break
    if not proxy:
        _proxy_cache = (time.monotonic(), None)
        return None

    # Use cached result if fresh
    ts, cached = _proxy_cache
    if time.monotonic() - ts < _PROXY_CHECK_TTL:
        return cached

    # Check if proxy is reachable
    alive = _check_proxy_alive(proxy)
    _proxy_cache = (time.monotonic(), proxy if alive else None)
    if not alive:
        logger.debug("Proxy %s not reachable, using direct connection", proxy)
    return proxy if alive else None


def _effective_provider() -> str:
    """Determine the actual provider to use, falling back to DuckDuckGo if credentials are missing."""
    provider = settings.web_search_provider.strip().lower() or "duckduckgo"
    if provider == "duckduckgo":
        return "duckduckgo"
    if provider == "brave":
        return "brave" if _resolve_api_key("brave") else "duckduckgo"
    if provider == "tavily":
        return "tavily" if _resolve_api_key("tavily") else "duckduckgo"
    if provider == "searxng":
        return "searxng" if _resolve_base_url() else "duckduckgo"
    if provider == "jina":
        return "jina" if _resolve_api_key("jina") else "duckduckgo"
    if provider == "kagi":
        return "kagi" if _resolve_api_key("kagi") else "duckduckgo"
    return "duckduckgo"


class WebSearchService:
    """Web search with multi-provider support and TTL cache."""

    def __init__(self):
        self._cache: dict[str, tuple[float, list[SearchResult]]] = {}

    def _cache_key(self, query: str, max_results: int) -> str:
        return f"{query.strip().lower()}:{max_results}"

    def _get_cached(self, key: str) -> list[SearchResult] | None:
        entry = self._cache.get(key)
        if entry is None:
            return None
        ts, results = entry
        if time.monotonic() - ts > CACHE_TTL_SECONDS:
            del self._cache[key]
            return None
        return results

    def _set_cached(self, key: str, results: list[SearchResult]) -> None:
        if len(self._cache) >= CACHE_MAX_SIZE:
            oldest_key = min(self._cache, key=lambda k: self._cache[k][0])
            del self._cache[oldest_key]
        self._cache[key] = (time.monotonic(), results)

    async def search(
        self, query: str, max_results: int | None = None, timeout: int | None = None
    ) -> list[SearchResult]:
        """Search the web using the configured provider with TTL cache."""
        n = min(max(max_results or settings.web_search_max_results, 1), 10)
        t = timeout or settings.web_search_timeout

        key = self._cache_key(query, n)
        cached = self._get_cached(key)
        if cached is not None:
            logger.debug("Web search cache hit: %s", query[:50])
            return cached

        provider = _effective_provider()
        logger.info("Web search: provider=%s, query=%s, max_results=%d", provider, query[:50], n)

        try:
            if provider == "brave":
                results = await self._search_brave(query, n)
            elif provider == "tavily":
                results = await self._search_tavily(query, n)
            elif provider == "searxng":
                results = await self._search_searxng(query, n)
            elif provider == "jina":
                results = await self._search_jina(query, n)
            elif provider == "kagi":
                results = await self._search_kagi(query, n)
            else:
                results = await self._search_duckduckgo(query, n, t)

            self._set_cached(key, results)
            return results
        except Exception as e:
            logger.warning("Web search failed (%s): %s", provider, e)
            return []

    async def _search_duckduckgo(
        self, query: str, n: int, timeout: int
    ) -> list[SearchResult]:
        from ddgs import DDGS

        proxy = _resolve_proxy()
        ddgs = DDGS(timeout=timeout, proxy=proxy)
        raw = await asyncio.wait_for(
            asyncio.to_thread(ddgs.text, query, max_results=n),
            timeout=timeout + 5,
        )
        return [
            SearchResult(title=r.get("title", ""), snippet=r.get("body", ""), url=r.get("href", ""))
            for r in (raw or [])
        ]

    async def _search_brave(self, query: str, n: int) -> list[SearchResult]:
        api_key = _resolve_api_key("brave")
        proxy = _resolve_proxy()
        headers = {
            "Accept": "application/json",
            "X-Subscription-Token": api_key,
        }
        async with httpx.AsyncClient(proxy=proxy) as client:
            for attempt in range(2):
                r = await client.get(
                    "https://api.search.brave.com/res/v1/web/search",
                    params={"q": query, "count": n},
                    headers=headers,
                    timeout=10.0,
                )
                if r.status_code != 429:
                    break
                if attempt == 0:
                    logger.warning("Brave rate limited, retrying in 1s")
                    await asyncio.sleep(1.0)
            r.raise_for_status()

        return [
            SearchResult(
                title=x.get("title", ""),
                snippet=x.get("description", ""),
                url=x.get("url", ""),
            )
            for x in r.json().get("web", {}).get("results", [])
        ]

    async def _search_tavily(self, query: str, n: int) -> list[SearchResult]:
        api_key = _resolve_api_key("tavily")
        proxy = _resolve_proxy()
        async with httpx.AsyncClient(proxy=proxy) as client:
            r = await client.post(
                "https://api.tavily.com/search",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"query": query, "max_results": n},
                timeout=15.0,
            )
            r.raise_for_status()

        return [
            SearchResult(
                title=x.get("title", ""),
                snippet=x.get("content", ""),
                url=x.get("url", ""),
            )
            for x in r.json().get("results", [])
        ]

    async def _search_searxng(self, query: str, n: int) -> list[SearchResult]:
        base_url = _resolve_base_url().rstrip("/")
        proxy = _resolve_proxy()
        async with httpx.AsyncClient(proxy=proxy) as client:
            r = await client.get(
                f"{base_url}/search",
                params={"q": query, "format": "json"},
                timeout=10.0,
            )
            r.raise_for_status()

        return [
            SearchResult(
                title=x.get("title", ""),
                snippet=x.get("content", ""),
                url=x.get("url", ""),
            )
            for x in r.json().get("results", [])[:n]
        ]

    async def _search_jina(self, query: str, n: int) -> list[SearchResult]:
        api_key = _resolve_api_key("jina")
        proxy = _resolve_proxy()
        headers = {"Accept": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        encoded_query = quote(query, safe="")
        async with httpx.AsyncClient(proxy=proxy) as client:
            r = await client.get(
                f"https://s.jina.ai/{encoded_query}",
                headers=headers,
                timeout=15.0,
            )
            r.raise_for_status()

        data = r.json().get("data", [])[:n]
        return [
            SearchResult(
                title=d.get("title", ""),
                snippet=d.get("content", "")[:500],
                url=d.get("url", ""),
            )
            for d in data
        ]

    async def _search_kagi(self, query: str, n: int) -> list[SearchResult]:
        api_key = _resolve_api_key("kagi")
        proxy = _resolve_proxy()
        async with httpx.AsyncClient(proxy=proxy) as client:
            r = await client.get(
                "https://kagi.com/api/v0/search",
                params={"q": query, "limit": n},
                headers={"Authorization": f"Bot {api_key}"},
                timeout=10.0,
            )
            r.raise_for_status()

        # t=0 items are search results
        return [
            SearchResult(
                title=d.get("title", ""),
                snippet=d.get("snippet", ""),
                url=d.get("url", ""),
            )
            for d in r.json().get("data", [])
            if d.get("t") == 0
        ]

    def format_results(self, results: list[SearchResult]) -> str:
        """Format search results as context for LLM."""
        if not results:
            return ""
        lines = ["以下是网页搜索结果，可作为补充参考：\n"]
        for i, r in enumerate(results, 1):
            lines.append(f"{i}. **{r.title}**")
            lines.append(f"   {r.snippet}")
            lines.append(f"   来源: {r.url}\n")
        return "\n".join(lines)


web_search_service = WebSearchService()
