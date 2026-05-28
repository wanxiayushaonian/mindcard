"""Anthropic native provider — uses the Messages API with httpx."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

import httpx

from app.providers.base import LLMProvider

logger = logging.getLogger(__name__)

# Anthropic API version
_ANTHROPIC_VERSION = "2023-06-01"


def _convert_messages(openai_messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    """Convert OpenAI messages to Anthropic format.

    Returns (system_prompt, messages) where messages only contain user/assistant roles.
    """
    system_parts: list[str] = []
    messages: list[dict[str, Any]] = []

    for msg in openai_messages:
        role = msg["role"]
        content = msg.get("content", "")

        if role == "system":
            system_parts.append(content)
        elif role in ("user", "assistant"):
            # Merge consecutive same-role messages (Anthropic requires alternation)
            if messages and messages[-1]["role"] == role:
                messages[-1]["content"] += "\n\n" + content
            else:
                messages.append({"role": role, "content": content})

    # Anthropic requires messages to start with user role
    if messages and messages[0]["role"] != "user":
        messages.insert(0, {"role": "user", "content": "..."})

    # Anthropic requires messages to end with user role for non-streaming
    # For streaming it's fine, but let's be safe

    system = "\n\n".join(system_parts)
    return system, messages


class AnthropicProvider(LLMProvider):
    """Direct httpx implementation for Anthropic Messages API."""

    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": self.api_key,
            "anthropic-version": _ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

    async def chat(
        self,
        messages: list[dict[str, Any]],
        max_tokens: int = 4096,
        temperature: float = 0.7,
        timeout: float = 60,
    ) -> str:
        if not self.api_key:
            return "LLM API key not configured."

        system, msgs = _convert_messages(messages)

        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": msgs,
        }
        if system:
            payload["system"] = system

        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
                    resp = await client.post(
                        f"{self.base_url}/v1/messages",
                        headers=self._headers(),
                        json=payload,
                    )
                    if resp.status_code in (429, 500, 502, 503) and attempt == 0:
                        logger.warning("Anthropic API %d, retrying...", resp.status_code)
                        continue
                    if resp.status_code >= 400:
                        body = resp.text[:500]
                        logger.error("Anthropic API %d: %s", resp.status_code, body)
                        resp.raise_for_status()
                    data = resp.json()
                    # Extract text from content blocks
                    content_blocks = data.get("content", [])
                    text_parts = [b["text"] for b in content_blocks if b.get("type") == "text"]
                    return "".join(text_parts)
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

        system, msgs = _convert_messages(messages)

        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": msgs,
            "stream": True,
        }
        if system:
            payload["system"] = system

        logger.debug("Anthropic stream request: model=%s, messages=%d, system=%d chars",
                      self.model, len(msgs), len(system))

        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0), trust_env=False) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/v1/messages",
                headers=self._headers(),
                json=payload,
            ) as resp:
                if resp.status_code >= 400:
                    body = await resp.aread()
                    logger.error("Anthropic stream %d: %s", resp.status_code, body[:500])
                    resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    try:
                        event = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    event_type = event.get("type")

                    # content_block_delta carries incremental text
                    if event_type == "content_block_delta":
                        delta = event.get("delta", {})
                        if delta.get("type") == "text_delta":
                            text = delta.get("text", "")
                            if text:
                                yield text

                    # message_stop signals end
                    elif event_type == "message_stop":
                        return

    async def list_models(self) -> list[str]:
        """Try OpenAI-compatible /v1/models endpoint (many proxies support this).

        For proxy services that mount Anthropic at a sub-path (e.g. /anthropic),
        we strip that suffix and try /v1/models on the root instead.
        """
        if not self.api_key:
            return []
        # Try the base URL as-is first, then strip common path suffixes
        candidates = [self.base_url]
        for suffix in ("/anthropic", "/v1", "/api"):
            if self.base_url.endswith(suffix):
                candidates.append(self.base_url[: -len(suffix)])
        for base in candidates:
            try:
                async with httpx.AsyncClient(timeout=15, trust_env=False) as client:
                    resp = await client.get(
                        f"{base}/v1/models",
                        headers={"Authorization": f"Bearer {self.api_key}"},
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    models = [m["id"] for m in data.get("data", [])]
                    models.sort()
                    return models
            except Exception:
                logger.debug("No /v1/models at %s", base)
                continue
        return []
