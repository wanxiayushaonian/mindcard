"""Shared LLM service — single place for all DeepSeek API calls."""

import json
from collections.abc import AsyncGenerator

import httpx

from app.config import settings


class LLMService:
    """Thin wrapper around the DeepSeek chat completions API."""

    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        self.base_url = base_url or settings.deepseek_base_url
        self.api_key = api_key or settings.deepseek_api_key

    async def complete(
        self,
        messages: list[dict[str, str]],
        max_tokens: int = 4096,
        temperature: float = 0.7,
        timeout: float = 60,
    ) -> str:
        """Single-shot completion. Returns the assistant message content."""
        if not self.api_key:
            return "LLM API key not configured. Please set DEEPSEEK_API_KEY."

        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{self.base_url}/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": "deepseek-chat",
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
            )
            data = resp.json()
            return data["choices"][0]["message"]["content"]

    async def complete_simple(
        self,
        system_prompt: str,
        user_content: str,
        max_tokens: int = 256,
        temperature: float = 0.5,
        timeout: float = 30,
    ) -> str:
        """Convenience: system prompt + user content → single response string."""
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
        if not self.api_key:
            yield "LLM API key not configured."
            return

        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": "deepseek-chat",
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "stream": True,
                },
            ) as resp:
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


llm_service = LLMService()
