"""OpenAI-compatible provider — works with DeepSeek, OpenAI, Gemini, Moonshot, etc."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

import httpx

from app.providers.base import LLMProvider

logger = logging.getLogger(__name__)


class OpenAICompatProvider(LLMProvider):
    """Single implementation for all OpenAI-compatible chat completion APIs."""

    # Reasoning models (DeepSeek R1/V4, OpenAI o1/o3, etc.) need extra tokens
    # for internal reasoning before producing output.
    _REASONING_MODEL_PREFIXES = ("deepseek-r", "deepseek-v4", "o1", "o3", "o4")

    def _is_reasoning_model(self) -> bool:
        return any(self.model.startswith(p) for p in self._REASONING_MODEL_PREFIXES)

    async def chat(
        self,
        messages: list[dict[str, Any]],
        max_tokens: int = 4096,
        temperature: float = 0.7,
        timeout: float = 60,
    ) -> str:
        if not self.api_key:
            return "LLM API key not configured."

        # Reasoning models need higher max_tokens to have room for actual output
        if self._is_reasoning_model() and max_tokens < 1024:
            max_tokens = max(max_tokens * 4, 1024)

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        for attempt in range(4):
            try:
                async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
                    resp = await client.post(
                        f"{self.base_url}/v1/chat/completions",
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        json=payload,
                    )
                    if resp.status_code == 429 and attempt < 3:
                        delay = 2 ** attempt
                        logger.warning("OpenAI compat API 429 rate limited, retrying in %ds...", delay)
                        await asyncio.sleep(delay)
                        continue
                    if resp.status_code in (500, 502, 503) and attempt < 3:
                        logger.warning("OpenAI compat API %d, retrying...", resp.status_code)
                        await asyncio.sleep(1)
                        continue
                    resp.raise_for_status()
                    data = resp.json()
                    msg = data["choices"][0]["message"]
                    content = msg.get("content") or ""
                    reasoning = msg.get("reasoning_content") or ""
                    result = content or reasoning  # fallback to reasoning output
                    if not result and data.get("choices"):
                        logger.warning(
                            "Empty response from %s (model=%s, max_tokens=%d, finish=%s)",
                            self.base_url, self.model, max_tokens,
                            data["choices"][0].get("finish_reason"),
                        )
                    return result
            except httpx.HTTPStatusError:
                if attempt < 3:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise
            except (httpx.TimeoutException, httpx.ConnectError):
                if attempt < 3:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise
        return ""

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncGenerator[str, None]:
        if not self.api_key:
            yield "LLM API key not configured."
            return

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }

        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0), trust_env=False) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=payload,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        return
                    try:
                        data = json.loads(data_str)
                        delta = data["choices"][0].get("delta", {})
                        content = delta.get("content")
                        if content:
                            yield content
                        elif self._is_reasoning_model():
                            reasoning = delta.get("reasoning_content")
                            if reasoning:
                                yield reasoning
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue

    async def list_models(self) -> list[str]:
        """GET /v1/models — returns available model IDs."""
        if not self.api_key:
            return []
        try:
            async with httpx.AsyncClient(timeout=15, trust_env=False) as client:
                resp = await client.get(
                    f"{self.base_url}/v1/models",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
                resp.raise_for_status()
                data = resp.json()
                models = [m["id"] for m in data.get("data", [])]
                models.sort()
                return models
        except Exception:
            logger.warning("Failed to list models from %s", self.base_url, exc_info=True)
            return []
