"""OpenAI-compatible provider — works with DeepSeek, OpenAI, Gemini, Moonshot, etc."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

import httpx

from app.providers.base import LLMProvider
from app.tools.base import ChatResponse

logger = logging.getLogger(__name__)


class OpenAICompatProvider(LLMProvider):
    """Single implementation for all OpenAI-compatible chat completion APIs."""

    _REASONING_MODEL_PREFIXES = ("deepseek-r", "deepseek-v4", "o1", "o3", "o4")

    def _is_reasoning_model(self) -> bool:
        return any(self.model.startswith(p) for p in self._REASONING_MODEL_PREFIXES)

    async def chat(
        self,
        messages: list[dict[str, Any]],
        max_tokens: int = 4096,
        temperature: float = 0.7,
        timeout: float = 60,
        tools: list[dict[str, Any]] | None = None,
    ) -> ChatResponse:
        if not self.api_key:
            return ChatResponse(content="LLM API key not configured.")

        if self._is_reasoning_model() and max_tokens < 1024:
            max_tokens = max(max_tokens * 4, 1024)

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if tools:
            payload["tools"] = tools

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
                        logger.warning("OpenAI compat API 429, retrying in %ds...", delay)
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

                    # Extract tool_calls if present
                    tool_calls: list[dict[str, Any]] = []
                    raw_tool_calls = msg.get("tool_calls")
                    if raw_tool_calls:
                        for tc in raw_tool_calls:
                            tool_calls.append({
                                "id": tc["id"],
                                "name": tc["function"]["name"],
                                "arguments": json.loads(tc["function"]["arguments"]),
                            })

                    if not content and not tool_calls and data.get("choices"):
                        logger.warning(
                            "Empty response from %s (model=%s, max_tokens=%d, finish=%s)",
                            self.base_url, self.model, max_tokens,
                            data["choices"][0].get("finish_reason"),
                        )
                    return ChatResponse(content=content, tool_calls=tool_calls)
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
        return ChatResponse()

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        max_tokens: int = 4096,
        temperature: float = 0.7,
        tools: list[dict[str, Any]] | None = None,
    ) -> AsyncGenerator[str | dict[str, Any], None]:
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
        if tools:
            payload["tools"] = tools

        logger.info("chat_stream: model=%s, messages=%d, tools=%d, max_tokens=%d",
                     self.model, len(messages), len(tools) if tools else 0, max_tokens)

        # Track tool call delta accumulation across chunks
        pending_tool_calls: dict[int, dict[str, str]] = {}

        for attempt in range(4):
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0), trust_env=False) as client:
                    async with client.stream(
                        "POST",
                        f"{self.base_url}/v1/chat/completions",
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        json=payload,
                    ) as resp:
                        resp.raise_for_status()
                        chunk_count = 0
                        async for line in resp.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            data_str = line[6:]
                            if data_str.strip() == "[DONE]":
                                logger.info("chat_stream: done, chunks=%d, tool_calls=%d",
                                            chunk_count, len(pending_tool_calls))
                                # Flush accumulated tool calls
                                if pending_tool_calls:
                                    for _idx, tc in sorted(pending_tool_calls.items()):
                                        yield {
                                            "type": "tool_call",
                                            "id": tc["id"],
                                            "name": tc["name"],
                                            "arguments": json.loads(tc["arguments_str"]),
                                        }
                                    yield {"type": "tool_calls_end"}
                                return
                            try:
                                data = json.loads(data_str)
                                delta = data["choices"][0].get("delta", {})

                                # Handle tool call deltas
                                if "tool_calls" in delta:
                                    for tc_delta in delta["tool_calls"]:
                                        idx = tc_delta.get("index", 0)
                                        if idx not in pending_tool_calls:
                                            pending_tool_calls[idx] = {
                                                "id": "",
                                                "name": "",
                                                "arguments_str": "",
                                            }
                                        if tc_delta.get("id"):
                                            pending_tool_calls[idx]["id"] = tc_delta["id"]
                                        fn = tc_delta.get("function", {})
                                        if fn.get("name"):
                                            pending_tool_calls[idx]["name"] = fn["name"]
                                        if fn.get("arguments"):
                                            pending_tool_calls[idx]["arguments_str"] += fn["arguments"]
                                    continue

                                # Text content
                                content = delta.get("content")
                                if content:
                                    chunk_count += 1
                                    yield content
                            except (json.JSONDecodeError, KeyError, IndexError):
                                continue
                        return  # stream ended without [DONE]
            except httpx.HTTPStatusError as e:
                if e.response.status_code in (429, 500, 502, 503) and attempt < 3:
                    delay = 2 ** attempt
                    logger.warning("chat_stream HTTP %d, retrying in %ds...", e.response.status_code, delay)
                    await asyncio.sleep(delay)
                    continue
                raise
            except (httpx.TimeoutException, httpx.ConnectError):
                if attempt < 3:
                    delay = 2 ** attempt
                    logger.warning("chat_stream connection error, retrying in %ds...", delay)
                    await asyncio.sleep(delay)
                    continue
                raise

    async def list_models(self) -> list[str]:
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
