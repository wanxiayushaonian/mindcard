"""Unit tests for EmbeddingService."""

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.services.embedding import EmbeddingService


class TestCardToText:
    """Pure function tests for card_to_text()."""

    def test_basic_card(self):
        result = EmbeddingService.card_to_text("Title", "Content here", ["kw1", "kw2"])
        assert result == "Title Content here kw1 kw2"

    def test_with_emotion_tag(self):
        result = EmbeddingService.card_to_text("Title", "Content", ["kw"], "happy")
        assert result == "Title Content kw happy"

    def test_empty_keywords(self):
        result = EmbeddingService.card_to_text("Title", "Content", [])
        assert result == "Title Content"

    def test_no_emotion_tag(self):
        result = EmbeddingService.card_to_text("Title", "Content", ["kw"])
        assert "happy" not in result

    def test_empty_title(self):
        result = EmbeddingService.card_to_text("", "Content here", ["kw"])
        assert result == "Content here kw"

    def test_long_content(self):
        long = "x" * 10000
        result = EmbeddingService.card_to_text("T", long, [])
        assert result == f"T {long}"

    def test_all_empty(self):
        result = EmbeddingService.card_to_text("", "", [])
        assert result == ""


class TestEmbedBatch:
    """Tests for batch embedding chunking logic."""

    @pytest.mark.asyncio
    async def test_empty_list(self):
        service = EmbeddingService()
        service._embed_raw = AsyncMock()
        result = await service.embed_batch([])
        assert result == []
        service._embed_raw.assert_not_called()

    @pytest.mark.asyncio
    async def test_single_text(self):
        service = EmbeddingService()
        service._embed_raw = AsyncMock(return_value=[[0.1, 0.2]])
        result = await service.embed_batch(["hello"])
        assert result == [[0.1, 0.2]]
        service._embed_raw.assert_called_once_with(["hello"])

    @pytest.mark.asyncio
    async def test_chunking_under_64(self):
        service = EmbeddingService()
        texts = [f"text_{i}" for i in range(30)]
        service._embed_raw = AsyncMock(return_value=[[0.1]] * 30)

        result = await service.embed_batch(texts)

        assert len(result) == 30
        service._embed_raw.assert_called_once()

    @pytest.mark.asyncio
    async def test_chunking_exactly_64(self):
        service = EmbeddingService()
        texts = [f"text_{i}" for i in range(64)]
        service._embed_raw = AsyncMock(return_value=[[0.1]] * 64)

        result = await service.embed_batch(texts)

        assert len(result) == 64
        service._embed_raw.assert_called_once()

    @pytest.mark.asyncio
    async def test_chunking_130_texts(self):
        service = EmbeddingService()
        texts = [f"text_{i}" for i in range(130)]

        # Return different embeddings per chunk to verify chunking
        async def mock_embed_raw(chunk):
            return [[len(chunk)]] * len(chunk)

        service._embed_raw = AsyncMock(side_effect=mock_embed_raw)

        result = await service.embed_batch(texts)

        assert len(result) == 130
        # Should be called 3 times: 64 + 64 + 2
        assert service._embed_raw.call_count == 3


class TestEmbed:
    """Tests for single text embedding."""

    @pytest.mark.asyncio
    async def test_returns_first_embedding(self):
        service = EmbeddingService()
        service._embed_raw = AsyncMock(return_value=[[0.1, 0.2, 0.3]])
        result = await service.embed("hello")
        assert result == [0.1, 0.2, 0.3]

    @pytest.mark.asyncio
    async def test_propagates_exception(self):
        service = EmbeddingService()
        service._embed_raw = AsyncMock(side_effect=Exception("Ollama down"))
        with pytest.raises(Exception, match="Ollama down"):
            await service.embed("hello")


class TestProviderDispatch:
    """Tests for embedding provider selection (Ollama vs OpenAI-compatible API)."""

    @pytest.mark.asyncio
    async def test_ollama_provider_uses_embed_endpoint(self):
        service = EmbeddingService()
        service._provider = "ollama"
        service._base_url = "http://localhost:11434"
        service._model = "bge-m3"
        client = AsyncMock()
        resp = MagicMock()
        resp.json.return_value = {"embeddings": [[0.1, 0.2]]}
        client.post = AsyncMock(return_value=resp)
        service._get_client = MagicMock(return_value=client)

        result = await service._embed_raw(["hello"])

        assert result == [[0.1, 0.2]]
        client.post.assert_called_once_with(
            "http://localhost:11434/api/embed",
            json={"model": "bge-m3", "input": ["hello"]},
        )

    @pytest.mark.asyncio
    async def test_openai_provider_uses_embeddings_endpoint(self):
        service = EmbeddingService()
        service._provider = "openai"
        service._base_url = "https://api.siliconflow.cn/v1"
        service._model = "BAAI/bge-m3"
        service._api_key = "sk-test"
        client = AsyncMock()
        resp = MagicMock()
        resp.json.return_value = {
            "data": [
                {"embedding": [0.1, 0.2]},
                {"embedding": [0.3, 0.4]},
            ]
        }
        client.post = AsyncMock(return_value=resp)
        service._get_client = MagicMock(return_value=client)

        result = await service._embed_raw(["a", "b"])

        assert result == [[0.1, 0.2], [0.3, 0.4]]
        client.post.assert_called_once_with(
            "https://api.siliconflow.cn/v1/embeddings",
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer sk-test",
            },
            json={"model": "BAAI/bge-m3", "input": ["a", "b"]},
        )

    @pytest.mark.asyncio
    async def test_openai_without_key_omits_auth_header(self):
        service = EmbeddingService()
        service._provider = "openai"
        service._base_url = "https://api.example.com/v1"
        service._model = "m"
        service._api_key = ""
        client = AsyncMock()
        resp = MagicMock()
        resp.json.return_value = {"data": [{"embedding": [1.0]}]}
        client.post = AsyncMock(return_value=resp)
        service._get_client = MagicMock(return_value=client)

        await service._embed_raw(["x"])

        _, kwargs = client.post.call_args
        assert kwargs["headers"] == {"Content-Type": "application/json"}

    @pytest.mark.asyncio
    async def test_openai_error_propagates(self):
        service = EmbeddingService()
        service._provider = "openai"
        service._base_url = "https://api.example.com/v1"
        service._model = "m"
        service._api_key = "sk-test"
        client = AsyncMock()
        resp = MagicMock()
        resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            "401", request=MagicMock(), response=MagicMock()
        )
        client.post = AsyncMock(return_value=resp)
        service._get_client = MagicMock(return_value=client)

        with pytest.raises(httpx.HTTPStatusError):
            await service._embed_raw(["x"])
