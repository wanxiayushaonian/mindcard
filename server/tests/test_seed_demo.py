"""Unit tests for seed_demo._llm_json retry behavior."""

import asyncio
from unittest.mock import MagicMock, patch

from scripts.seed_demo import _llm_json


def test_llm_json_retries_then_succeeds() -> None:
    """A transient failure (empty/invalid response) should be retried."""
    calls = {"n": 0}

    async def fake_complete_simple(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise Exception("Expecting value: line 1 column 1")
        return '{"summary": "ok"}'

    service = MagicMock()
    service.complete_simple = fake_complete_simple

    with patch("scripts.seed_demo.get_llm_service", return_value=service):
        result = asyncio.run(_llm_json("system", "user"))

    assert result == {"summary": "ok"}
    assert calls["n"] == 2  # failed once, then retried


def test_llm_json_gives_up_after_retries() -> None:
    """Persistent failure should exhaust retries and fall back to {}."""
    calls = {"n": 0}

    async def always_fail(*args, **kwargs):
        calls["n"] += 1
        raise Exception("model unavailable")

    service = MagicMock()
    service.complete_simple = always_fail

    with patch("scripts.seed_demo.get_llm_service", return_value=service):
        result = asyncio.run(_llm_json("system", "user", retries=2))

    assert result == {}
    assert calls["n"] == 2
