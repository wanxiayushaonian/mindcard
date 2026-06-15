"""Tests for ForkCompressor service."""

import pytest
from unittest.mock import AsyncMock, patch

from app.services.fork_compress import ForkCompressor


@pytest.fixture
def compressor():
    return ForkCompressor()


def test_format_conversation(compressor):
    messages = [
        {"role": "user", "content": "什么是RAG？"},
        {"role": "assistant", "content": "RAG是检索增强生成..."},
        {"role": "user", "content": "向量检索怎么优化？"},
    ]
    result = compressor._format_conversation(messages)
    assert "用户: 什么是RAG？" in result
    assert "助手: RAG是检索增强生成..." in result
    assert "用户: 向量检索怎么优化？" in result


@pytest.mark.asyncio
async def test_compress_none_strategy(compressor):
    result = await compressor.compress([], strategy="none")
    assert result is None


@pytest.mark.asyncio
async def test_compress_inherit_strategy(compressor):
    messages = [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi"},
    ]
    result = await compressor.compress(messages, strategy="inherit")
    assert "用户: hello" in result
    assert "助手: hi" in result


@pytest.mark.asyncio
async def test_compress_compress_strategy(compressor):
    messages = [
        {"role": "user", "content": "什么是RAG？"},
        {"role": "assistant", "content": "RAG是检索增强生成，结合了检索和生成两种能力。"},
    ]
    with patch("app.services.fork_compress.llm_service") as mock_llm:
        mock_llm.complete_simple = AsyncMock(return_value="主题：RAG原理\n关键结论：RAG结合检索和生成")
        result = await compressor.compress(messages, strategy="compress")
        assert "RAG原理" in result
        mock_llm.complete_simple.assert_called_once()
