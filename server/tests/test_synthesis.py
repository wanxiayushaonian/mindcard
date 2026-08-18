"""Unit tests for produce_synthesis (VISION 理念6 两遍式第二遍)."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.synthesis import produce_synthesis


def test_produce_synthesis_returns_refined_content() -> None:
    provider = MagicMock()
    provider.chat = AsyncMock(return_value=MagicMock(content="精修后的报告", usage={"total_tokens": 100}))
    service = MagicMock()
    service._build_synthesis_provider.return_value = provider
    service.synthesis_provider_name = "claude"

    with patch("app.services.llm.get_llm_service", return_value=service):
        result = asyncio.run(produce_synthesis("收敛目标", "草稿"))

    assert result == "精修后的报告"


def test_produce_synthesis_falls_back_to_draft_on_error() -> None:
    provider = MagicMock()
    provider.chat = AsyncMock(side_effect=Exception("model unavailable"))
    service = MagicMock()
    service._build_synthesis_provider.return_value = provider
    service.synthesis_provider_name = "claude"

    with patch("app.services.llm.get_llm_service", return_value=service):
        result = asyncio.run(produce_synthesis("收敛目标", "原始草稿"))

    assert result == "原始草稿"


def test_produce_synthesis_falls_back_on_empty_refinement() -> None:
    provider = MagicMock()
    provider.chat = AsyncMock(return_value=MagicMock(content="   ", usage={"total_tokens": 10}))
    service = MagicMock()
    service._build_synthesis_provider.return_value = provider
    service.synthesis_provider_name = "claude"

    with patch("app.services.llm.get_llm_service", return_value=service):
        result = asyncio.run(produce_synthesis("收敛目标", "草稿内容"))

    assert result == "草稿内容"
