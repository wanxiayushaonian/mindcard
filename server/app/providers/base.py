"""Abstract base class for LLM providers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from typing import Any

from app.tools.base import ChatResponse


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
        tools: list[dict[str, Any]] | None = None,
    ) -> ChatResponse:
        """Non-streaming chat completion. Returns ChatResponse with content and optional tool_calls."""

    @abstractmethod
    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        max_tokens: int = 4096,
        temperature: float = 0.7,
        tools: list[dict[str, Any]] | None = None,
    ) -> AsyncGenerator[str | dict[str, Any], None]:
        """Streaming chat completion.

        Yields str (text chunks) or dict (metadata/tool_call events).
        When tools are provided and invoked, yields dicts:
          {"type": "tool_call", "id": ..., "name": ..., "arguments": ...}
          {"type": "tool_calls_end"}
        """

    async def list_models(self) -> list[str]:
        """Fetch available model IDs from the provider API. Default: return empty list."""
        return []
