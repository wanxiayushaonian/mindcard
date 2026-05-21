import logging

import numpy as np

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Embedding service using BGE-M3 (BAAI) for Chinese-friendly text embeddings."""

    def __init__(self):
        self._model = None

    def _load_model(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            from app.config import settings

            logger.info("Loading embedding model: %s", settings.embedding_model)
            self._model = SentenceTransformer(settings.embedding_model)
            logger.info("Embedding model loaded (dim=%d)", settings.embedding_dim)

    async def embed(self, text: str) -> list[float]:
        """Generate embedding for a single text."""
        self._load_model()
        embedding = self._model.encode(text, normalize_embeddings=True)
        return embedding.tolist()

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for a batch of texts."""
        self._load_model()
        embeddings = self._model.encode(texts, normalize_embeddings=True, batch_size=32)
        return [e.tolist() for e in embeddings]

    @staticmethod
    def card_to_text(title: str, content: str, keywords: list[str]) -> str:
        """Convert card fields to a single text for embedding."""
        parts = []
        if title:
            parts.append(title)
        parts.append(content)
        if keywords:
            parts.append(" ".join(keywords))
        return " ".join(parts)


embedding_service = EmbeddingService()
