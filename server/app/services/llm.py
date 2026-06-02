"""Shared LLM service — delegates to a configurable provider backend."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from app.config import settings
from app.providers.base import LLMProvider
from app.providers.factory import make_provider


class LLMService:
    """Thin facade over LLMProvider. Keeps the existing interface so consumers
    (rag.py, ai.py, external.py) need zero changes."""

    def __init__(self) -> None:
        self._provider_name: str = settings.default_llm_provider
        api_key, base_url = self._resolve_credentials(settings.default_llm_provider)
        self._provider: LLMProvider = make_provider(
            provider_name=settings.default_llm_provider,
            api_key=api_key,
            base_url=base_url,
            model=settings.default_llm_model or None,
        )

    @staticmethod
    def _resolve_credentials(provider_name: str) -> tuple[str, str | None]:
        """Return (api_key, base_url) for the given provider."""
        from app.providers.registry import PROVIDERS
        spec = PROVIDERS.get(provider_name)
        if not spec:
            return ("", None)
        # Map provider name to settings fields
        key_map = {
            "deepseek": (settings.deepseek_api_key, settings.deepseek_base_url),
            "openai": (settings.openai_api_key, settings.openai_base_url),
            "claude": (settings.anthropic_api_key, settings.anthropic_base_url),
            "gemini": (settings.gemini_api_key, None),
            "moonshot": (settings.moonshot_api_key, None),
            "custom": (settings.custom_api_key, settings.custom_base_url or None),
        }
        api_key, base_url = key_map.get(provider_name, ("", None))
        return (api_key, base_url)

    # ------------------------------------------------------------------
    # Provider switching
    # ------------------------------------------------------------------

    def switch_provider(
        self,
        provider_name: str,
        api_key: str,
        base_url: str | None = None,
        model: str | None = None,
    ) -> None:
        """Hot-swap the underlying provider (e.g. when user changes settings)."""
        self._provider_name = provider_name
        self._provider = make_provider(provider_name, api_key, base_url, model)

    @property
    def current_provider(self) -> LLMProvider:
        return self._provider

    # ------------------------------------------------------------------
    # Original interface — unchanged signatures
    # ------------------------------------------------------------------

    async def complete(
        self,
        messages: list[dict[str, str]],
        max_tokens: int = 4096,
        temperature: float = 0.7,
        timeout: float = 60,
    ) -> str:
        """Single-shot completion. Returns the assistant message content."""
        return await self._provider.chat(
            messages, max_tokens=max_tokens, temperature=temperature, timeout=timeout
        )

    async def complete_simple(
        self,
        system_prompt: str,
        user_content: str,
        max_tokens: int = 256,
        temperature: float = 0.5,
        timeout: float = 30,
    ) -> str:
        """Convenience: system prompt + user content -> single response string."""
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]
        result = await self.complete(
            messages, max_tokens=max_tokens, temperature=temperature, timeout=timeout
        )
        return result.strip()

    async def stream(
        self,
        messages: list[dict[str, str]],
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncGenerator[str, None]:
        """Streaming completion. Yields content chunks."""
        async for chunk in self._provider.chat_stream(
            messages, max_tokens=max_tokens, temperature=temperature
        ):
            yield chunk


llm_service = LLMService()
