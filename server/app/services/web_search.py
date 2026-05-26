import logging
import time
from dataclasses import dataclass

from ddgs import DDGS

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 300  # 5 minutes
CACHE_MAX_SIZE = 256


@dataclass
class SearchResult:
    title: str
    snippet: str
    url: str


class WebSearchService:
    """Web search using DuckDuckGo (free, no API key required) with TTL cache."""

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
        # Evict oldest entries if cache is full
        if len(self._cache) >= CACHE_MAX_SIZE:
            oldest_key = min(self._cache, key=lambda k: self._cache[k][0])
            del self._cache[oldest_key]
        self._cache[key] = (time.monotonic(), results)

    def search(self, query: str, max_results: int = 8, timeout: int = 10) -> list[SearchResult]:
        """Search the web using DuckDuckGo with timeout and TTL cache."""
        key = self._cache_key(query, max_results)
        cached = self._get_cached(key)
        if cached is not None:
            logger.debug("Web search cache hit: %s", query[:50])
            return cached

        try:
            ddgs = DDGS(timeout=timeout)
            results = list(ddgs.text(query, max_results=max_results))
            search_results = [
                SearchResult(
                    title=r.get("title", ""),
                    snippet=r.get("body", ""),
                    url=r.get("href", ""),
                )
                for r in results
            ]
            self._set_cached(key, search_results)
            return search_results
        except Exception as e:
            logger.warning(f"Web search failed: {e}")
            return []

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
