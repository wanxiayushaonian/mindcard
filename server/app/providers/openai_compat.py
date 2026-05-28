"""OpenAI-compatible provider — works with DeepSeek, OpenAI, Gemini, Moonshot, etc."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

import httpx

from app.providers.base import LLMProvider

logger = logging.getLogger(__name__)


class OpenAICompatProvider(LLMProvider):
    """Single implementation for all OpenAI-compatible chat completion APIs."""

    async def chat(
        self,
        messages: list[dict[str, Any]],
        max_tokens: int = 4096,
        temperature: float = 0.7,
        timeout: float = 60,
    ) -> str:
        if not self.api_key:
            return "LLM API key not configured."

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
                    resp = await client.post(
                        f"{self.base_url}/v1/chat/completions",
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        json=payload,
                    )
                    if resp.status_code in (429, 500, 502, 503) and attempt == 0:
                        logger.warning("OpenAI compat API %d, retrying...", resp.status_code)
                        continue
                    resp.raise_for_status()
                    data = resp.json()
                    return data["choices"][0]["message"]["content"]
            except httpx.HTTPStatusError:
                if attempt == 0:
                    continue
                raise
            except (httpx.TimeoutException, httpx.ConnectError):
                if attempt == 0:
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
