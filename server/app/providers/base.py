"""Abstract base class for LLM providers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from typing import Any


class LLMProvider(ABC):
    """Unified interface for all LLM backends."""

    def __init__(self, api_key: str, base_url: str, model: str):
        self.api_key = api_key
        self.base_url = base_url
        self.model = model

    @abstractmethod
    async def chat(
        self,
        messages: list[dict[str, Any]],
        max_tokens: int = 4096,
        temperature: float = 0.7,
        timeout: float = 60,
    ) -> str:
        """Non-streaming chat completion. Returns assistant content."""

    @abstractmethod
    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncGenerator[str, None]:
        """Streaming chat completion. Yields content chunks."""

    async def list_models(self) -> list[str]:
        """Fetch available model IDs from the provider API. Default: return empty list."""
        return []
