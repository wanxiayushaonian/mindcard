import logging

import httpx

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Embedding service using Ollama API with bge-m3 model."""

    def __init__(self):
        from app.config import settings
        self._base_url = settings.ollama_base_url.rstrip("/")
        self._model = settings.embedding_model
        self._client: httpx.AsyncClient | None = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=httpx.Timeout(120.0), trust_env=False)
        return self._client

    async def _embed_raw(self, texts: list[str]) -> list[list[float]]:
        """Call Ollama embed API and return raw embeddings."""
        client = self._get_client()
        try:
            resp = await client.post(
                f"{self._base_url}/api/embed",
                json={"model": self._model, "input": texts},
            )
            resp.raise_for_status()
            data = resp.json()
            return data["embeddings"]
        except Exception as e:
            logger.error("Ollama embed API failed (%s): %s", self._base_url, e)
            raise

    async def embed(self, text: str) -> list[float]:
        """Generate embedding for a single text."""
        logger.debug("Embedding text (length=%d) with model %s", len(text), self._model)
        embeddings = await self._embed_raw([text])
        logger.debug("Embedding generated, dim=%d", len(embeddings[0]))
        return embeddings[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for a batch of texts.

        Ollama handles batching internally, so we send all at once.
        For very large batches, split into chunks of 64.
        """
        if not texts:
            return []
        CHUNK = 64
        all_embeddings: list[list[float]] = []
        for i in range(0, len(texts), CHUNK):
            chunk = texts[i : i + CHUNK]
            all_embeddings.extend(await self._embed_raw(chunk))
        return all_embeddings

    @staticmethod
    def card_to_text(title: str, content: str, keywords: list[str], emotion_tag: str = "") -> str:
        """Convert card fields to a single text for embedding."""
        parts = []
        if title:
            parts.append(title)
        parts.append(content)
        if keywords:
            parts.append(" ".join(keywords))
        if emotion_tag:
            parts.append(emotion_tag)
        return " ".join(parts)

    async def close(self):
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()


embedding_service = EmbeddingService()
