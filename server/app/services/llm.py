"""Shared LLM service — delegates to a configurable provider backend."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from typing import Any

from app.config import settings
from app.providers.base import LLMProvider
from app.providers.factory import make_provider
from app.tools.base import ChatResponse

logger = logging.getLogger(__name__)


class LLMService:
    """Thin facade over LLMProvider."""

    def __init__(self) -> None:
        self._provider_name: str = settings.default_llm_provider
        api_key, base_url = self._resolve_credentials(settings.default_llm_provider)
        self._provider: LLMProvider = make_provider(
            provider_name=settings.default_llm_provider,
            api_key=api_key,
            base_url=base_url,
            model=settings.default_llm_model or None,
        )
        self._extraction_provider: LLMProvider | None = None

    @staticmethod
    def _resolve_credentials(provider_name: str) -> tuple[str, str | None]:
        from app.providers.registry import PROVIDERS
        spec = PROVIDERS.get(provider_name)
        if not spec:
            return ("", None)
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
        self._provider_name = provider_name
        self._provider = make_provider(provider_name, api_key, base_url, model)

    @property
    def current_provider(self) -> LLMProvider:
        return self._provider

    @property
    def extraction_provider(self) -> LLMProvider:
        if self._extraction_provider is None:
            self._extraction_provider = self._build_extraction_provider()
        return self._extraction_provider

    @property
    def extraction_provider_name(self) -> str:
        return settings.extraction_llm_provider or settings.default_llm_provider

    @property
    def extraction_model_name(self) -> str:
        return settings.extraction_llm_model or ""

    def _build_extraction_provider(self) -> LLMProvider:
        provider_name = settings.extraction_llm_provider or settings.default_llm_provider
        api_key, base_url = self._resolve_credentials(provider_name)
        return make_provider(provider_name, api_key, base_url, settings.extraction_llm_model or None)

    def reset_extraction_provider(self) -> None:
        self._extraction_provider = None

    # ------------------------------------------------------------------
    # Completion methods
    # ------------------------------------------------------------------

    async def complete(
        self,
        messages: list[dict[str, str]],
        max_tokens: int = 4096,
        temperature: float = 0.7,
        timeout: float = 60,
        tools: list[dict[str, Any]] | None = None,
    ) -> ChatResponse:
        return await self._provider.chat(
            messages, max_tokens=max_tokens, temperature=temperature,
            timeout=timeout, tools=tools,
        )

    async def complete_simple(
        self,
        system_prompt: str,
        user_content: str,
        max_tokens: int = 256,
        temperature: float = 0.5,
        timeout: float = 30,
    ) -> str:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]
        result = await self.complete(
            messages, max_tokens=max_tokens, temperature=temperature, timeout=timeout
        )
        return result.content.strip()

    async def extraction_complete_simple(
        self,
        system_prompt: str,
        user_content: str,
        max_tokens: int = 256,
        temperature: float = 0.5,
        timeout: float = 30,
    ) -> str:
        provider = self.extraction_provider
        provider_name = self.extraction_provider_name
        model_name = getattr(provider, 'model', '?')
        logger.info("extraction_complete_simple: provider=%s, model=%s", provider_name, model_name)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]
        try:
            result = await provider.chat(
                messages, max_tokens=max_tokens, temperature=temperature, timeout=timeout
            )
            if not result.content.strip():
                logger.warning("extraction_complete_simple: empty response from %s/%s", provider_name, model_name)
            return result.content.strip()
        except Exception as e:
            logger.error("extraction_complete_simple failed: %s %s: %s", provider_name, model_name, e)
            raise

    async def stream(
        self,
        messages: list[dict[str, str]],
        max_tokens: int = 4096,
        temperature: float = 0.7,
        tools: list[dict[str, Any]] | None = None,
    ) -> AsyncGenerator[str | dict[str, Any], None]:
        async for chunk in self._provider.chat_stream(
            messages, max_tokens=max_tokens, temperature=temperature, tools=tools
        ):
            yield chunk


llm_service = LLMService()
