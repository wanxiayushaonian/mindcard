import logging
from dataclasses import dataclass

from ddgs import DDGS

logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    title: str
    snippet: str
    url: str


class WebSearchService:
    """Web search using DuckDuckGo (free, no API key required)."""

    def search(self, query: str, max_results: int = 8, timeout: int = 10) -> list[SearchResult]:
        """Search the web using DuckDuckGo with timeout."""
        try:
            ddgs = DDGS(timeout=timeout)
            results = list(ddgs.text(query, max_results=max_results))
            return [
                SearchResult(
                    title=r.get("title", ""),
                    snippet=r.get("body", ""),
                    url=r.get("href", ""),
                )
                for r in results
            ]
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
