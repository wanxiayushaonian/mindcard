"""Anthropic native provider — uses the Messages API with httpx."""

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

_ANTHROPIC_VERSION = "2023-12-15"


def _convert_messages(
    openai_messages: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    """Convert OpenAI messages to Anthropic format.

    Handles system, user, assistant, tool roles and tool_calls/tool_result blocks.
    """
    system_parts: list[str] = []
    messages: list[dict[str, Any]] = []

    for msg in openai_messages:
        role = msg["role"]
        content = msg.get("content", "")

        if role == "system":
            system_parts.append(content)

        elif role == "tool":
            # OpenAI tool result → Anthropic tool_result in user message
            tool_result_block: dict[str, Any] = {
                "type": "tool_result",
                "tool_use_id": msg.get("tool_call_id", ""),
                "content": content,
            }
            if messages and messages[-1]["role"] == "user" and isinstance(
                messages[-1]["content"], list
            ):
                messages[-1]["content"].append(tool_result_block)
            else:
                messages.append({"role": "user", "content": [tool_result_block]})

        elif role == "assistant":
            tool_calls = msg.get("tool_calls")
            if tool_calls:
                # Assistant with tool_calls → text + tool_use blocks
                blocks: list[dict[str, Any]] = []
                if content:
                    blocks.append({"type": "text", "text": content})
                for tc in tool_calls:
                    fn = tc.get("function", {})
                    blocks.append({
                        "type": "tool_use",
                        "id": tc.get("id", ""),
                        "name": fn.get("name", ""),
                        "input": json.loads(fn.get("arguments", "{}")),
                    })
                messages.append({"role": "assistant", "content": blocks})
            else:
                text = content or ""
                if messages and messages[-1]["role"] == "assistant" and isinstance(
                    messages[-1]["content"], str
                ):
                    messages[-1]["content"] += "\n\n" + text
                else:
                    messages.append({"role": "assistant", "content": text})

        elif role in ("user",):
            if messages and messages[-1]["role"] == role and isinstance(
                messages[-1]["content"], str
            ):
                messages[-1]["content"] += "\n\n" + content
            else:
                messages.append({"role": role, "content": content})

    if messages and messages[0]["role"] != "user":
        messages.insert(0, {"role": "user", "content": "..."})

    system = "\n\n".join(system_parts)
    return system, messages


def _convert_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert OpenAI-format tools to Anthropic format."""
    anthropic_tools: list[dict[str, Any]] = []
    for t in tools:
        fn = t.get("function", {})
        anthropic_tools.append({
            "name": fn.get("name", ""),
            "description": fn.get("description", ""),
            "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
        })
    return anthropic_tools


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
        tools: list[dict[str, Any]] | None = None,
    ) -> ChatResponse:
        if not self.api_key:
            return ChatResponse(content="LLM API key not configured.")

        system, msgs = _convert_messages(messages)

        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": msgs,
        }
        if system:
            payload["system"] = system
        if tools:
            payload["tools"] = _convert_tools(tools)

        for attempt in range(4):
            try:
                async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
                    resp = await client.post(
                        f"{self.base_url}/v1/messages",
                        headers=self._headers(),
                        json=payload,
                    )
                    if resp.status_code == 429 and attempt < 3:
                        delay = 2 ** attempt
                        logger.warning("Anthropic API 429, retrying in %ds...", delay)
                        await asyncio.sleep(delay)
                        continue
                    if resp.status_code in (500, 502, 503) and attempt < 3:
                        logger.warning("Anthropic API %d, retrying...", resp.status_code)
                        await asyncio.sleep(1)
                        continue
                    if resp.status_code >= 400:
                        body = resp.text[:500]
                        logger.error("Anthropic API %d: %s", resp.status_code, body)
                        resp.raise_for_status()
                    data = resp.json()
                    content_blocks = data.get("content", [])
                    text_parts: list[str] = []
                    tool_calls: list[dict[str, Any]] = []
                    for block in content_blocks:
                        if block.get("type") == "text":
                            text_parts.append(block["text"])
                        elif block.get("type") == "tool_use":
                            tool_calls.append({
                                "id": block["id"],
                                "name": block["name"],
                                "arguments": block.get("input", {}),
                            })
                    usage: dict[str, int] | None = None
                    raw_usage = data.get("usage")
                    if raw_usage:
                        inp = raw_usage.get("input_tokens", 0)
                        out = raw_usage.get("output_tokens", 0)
                        usage = {
                            "input_tokens": inp,
                            "output_tokens": out,
                            "total_tokens": inp + out,
                        }
                    return ChatResponse(
                        content="".join(text_parts),
                        tool_calls=tool_calls,
                        usage=usage,
                    )
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
        if tools:
            payload["tools"] = _convert_tools(tools)

        current_tool: dict[str, str] | None = None
        has_tool_calls = False
        current_thinking: dict[str, str] | None = None

        for attempt in range(4):
            try:
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

                            if event_type == "content_block_start":
                                block = event.get("content_block", {})
                                if block.get("type") == "tool_use":
                                    current_tool = {
                                        "id": block.get("id", ""),
                                        "name": block.get("name", ""),
                                        "arguments_str": "",
                                    }
                                    has_tool_calls = True
                                elif block.get("type") == "thinking":
                                    current_thinking = {"content": ""}

                            elif event_type == "content_block_delta":
                                delta = event.get("delta", {})
                                if delta.get("type") == "text_delta":
                                    text = delta.get("text", "")
                                    if text:
                                        yield text
                                elif delta.get("type") == "thinking_delta":
                                    text = delta.get("thinking", "")
                                    if text:
                                        if current_thinking is not None:
                                            current_thinking["content"] += text
                                        yield {"type": "thinking", "content": text}
                                elif delta.get("type") == "input_json_delta" and current_tool:
                                    current_tool["arguments_str"] += delta.get("partial_json", "")

                            elif event_type == "content_block_stop":
                                if current_tool:
                                    args_str = current_tool["arguments_str"] or "{}"
                                    yield {
                                        "type": "tool_call",
                                        "id": current_tool["id"],
                                        "name": current_tool["name"],
                                        "arguments": json.loads(args_str),
                                    }
                                    current_tool = None
                                if current_thinking is not None:
                                    current_thinking = None

                            elif event_type == "message_stop":
                                if has_tool_calls:
                                    yield {"type": "tool_calls_end"}
                                return
                        return  # stream ended without message_stop
            except httpx.HTTPStatusError as e:
                if e.response.status_code in (429, 500, 502, 503) and attempt < 3:
                    delay = 2 ** attempt
                    logger.warning("Anthropic stream HTTP %d, retrying in %ds...", e.response.status_code, delay)
                    await asyncio.sleep(delay)
                    continue
                raise
            except (httpx.TimeoutException, httpx.ConnectError):
                if attempt < 3:
                    delay = 2 ** attempt
                    logger.warning("Anthropic stream connection error, retrying in %ds...", delay)
                    await asyncio.sleep(delay)
                    continue
                raise

    async def list_models(self) -> list[str]:
        if not self.api_key:
            return []
        candidates = [self.base_url]
        for suffix in ("/anthropic", "/v1", "/api"):
            if self.base_url.endswith(suffix):
                candidates.append(self.base_url[: -len(suffix)])
        for base in candidates:
            try:
                async with httpx.AsyncClient(timeout=15, trust_env=False) as client:
                    resp = await client.get(
                        f"{base}/v1/models",
                        headers={"x-api-key": self.api_key, "anthropic-version": _ANTHROPIC_VERSION},
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
