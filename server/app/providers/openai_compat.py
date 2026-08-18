"""OpenAI-compatible provider — works with DeepSeek, OpenAI, Gemini, Moonshot, etc."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncGenerator, Generator
from typing import Any

import httpx

from app.providers.base import LLMProvider
from app.tools.base import ChatResponse

logger = logging.getLogger(__name__)

_OPEN_TAG = "<think>"
_CLOSE_TAG = "</think>"


class _ThinkTagParser:
    """Stateful parser that extracts <think> tags from streamed text chunks.

    Handles tags split across chunk boundaries by buffering partial matches.
    """

    def __init__(self) -> None:
        self._in_think = False
        self._buf = ""

    def feed(self, chunk: str) -> Generator[str | dict[str, Any], None, None]:
        """Process a text chunk, yielding content strings and thinking event dicts."""
        text = self._buf + chunk
        self._buf = ""

        while text:
            if self._in_think:
                close_pos = text.find(_CLOSE_TAG)
                if close_pos == -1:
                    # No closing tag — buffer might contain partial tag
                    if len(text) >= len(_CLOSE_TAG):
                        yield {"type": "thinking", "content": text[: -len(_CLOSE_TAG) + 1]}
                        self._buf = text[-len(_CLOSE_TAG) + 1 :]
                    else:
                        self._buf = text
                    return
                else:
                    if close_pos > 0:
                        yield {"type": "thinking", "content": text[:close_pos]}
                    self._in_think = False
                    text = text[close_pos + len(_CLOSE_TAG) :]
            else:
                open_pos = text.find(_OPEN_TAG)
                if open_pos == -1:
                    # No opening tag — buffer might contain partial tag
                    if len(text) >= len(_OPEN_TAG):
                        yield text[: -len(_OPEN_TAG) + 1]
                        self._buf = text[-len(_OPEN_TAG) + 1 :]
                    else:
                        self._buf = text
                    return
                else:
                    if open_pos > 0:
                        yield text[:open_pos]
                    self._in_think = True
                    text = text[open_pos + len(_OPEN_TAG) :]

    def flush(self) -> Generator[str | dict[str, Any], None, None]:
        """Flush remaining buffer at stream end."""
        if self._buf:
            if self._in_think:
                yield {"type": "thinking", "content": self._buf}
            else:
                yield self._buf
            self._buf = ""


class OpenAICompatProvider(LLMProvider):
    """Single implementation for all OpenAI-compatible chat completion APIs."""

    _REASONING_MODEL_PREFIXES = ("deepseek-r", "deepseek-v4", "o1", "o3", "o4")

    def _is_reasoning_model(self) -> bool:
        return any(self.model.startswith(p) for p in self._REASONING_MODEL_PREFIXES)

    def _is_deepseek_thinking(self) -> bool:
        """DeepSeek models that support chat_template_kwargs thinking mode."""
        return self.model.startswith("deepseek-v4") or self.model.startswith("deepseek-r")

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
        if self._is_deepseek_thinking():
            payload["chat_template_kwargs"] = {"thinking": True}

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
                    usage: dict[str, int] | None = None
                    raw_usage = data.get("usage")
                    if raw_usage:
                        usage = {
                            "input_tokens": raw_usage.get("prompt_tokens", 0),
                            "output_tokens": raw_usage.get("completion_tokens", 0),
                            "total_tokens": raw_usage.get("total_tokens", 0),
                        }
                    return ChatResponse(content=content, tool_calls=tool_calls, usage=usage)
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
        if self._is_deepseek_thinking():
            payload["chat_template_kwargs"] = {"thinking": True}

        logger.info("chat_stream: model=%s, messages=%d, tools=%d, max_tokens=%d",
                     self.model, len(messages), len(tools) if tools else 0, max_tokens)

        # Track tool call delta accumulation across chunks
        pending_tool_calls: dict[int, dict[str, str]] = {}
        think_parser = _ThinkTagParser()

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
                                # Flush think parser remaining buffer
                                for ev in think_parser.flush():
                                    yield ev
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

                                # Text content — parse for <think> tags in real-time
                                content = delta.get("content")
                                if content:
                                    chunk_count += 1
                                    for ev in think_parser.feed(content):
                                        yield ev

                                # DeepSeek reasoning_content — native thinking field
                                reasoning = delta.get("reasoning_content")
                                if reasoning:
                                    yield {"type": "thinking", "content": reasoning}
                            except (json.JSONDecodeError, KeyError, IndexError):
                                continue
                        for ev in think_parser.flush():
                            yield ev
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
