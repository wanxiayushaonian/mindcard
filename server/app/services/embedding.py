import asyncio
import logging
import os
import threading

import numpy as np
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load .env so HF_ENDPOINT and other non-pydantic vars reach the real environment
load_dotenv(override=False)


class EmbeddingService:
    """Embedding service using BGE-M3 (BAAI) for Chinese-friendly text embeddings."""

    def __init__(self):
        self._model = None
        self._lock = threading.Lock()

    def _load_model(self):
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            try:
                from sentence_transformers import SentenceTransformer
                from app.config import settings

                logger.info("Loading embedding model: %s", settings.embedding_model)
                self._model = SentenceTransformer(settings.embedding_model)
                logger.info("Embedding model loaded (dim=%d)", settings.embedding_dim)
            except Exception as e:
                logger.error("Failed to load embedding model: %s", e)
                self._model = None

    async def embed(self, text: str) -> list[float]:
        """Generate embedding for a single text. Raises RuntimeError if model unavailable."""
        self._load_model()
        if self._model is None:
            raise RuntimeError("Embedding model failed to load")
        loop = asyncio.get_event_loop()
        embedding = await loop.run_in_executor(
            None, lambda: self._model.encode(text, normalize_embeddings=True)
        )
        return embedding.tolist()

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for a batch of texts."""
        self._load_model()
        if self._model is None:
            raise RuntimeError("Embedding model failed to load")
        loop = asyncio.get_event_loop()
        embeddings = await loop.run_in_executor(
            None, lambda: self._model.encode(texts, normalize_embeddings=True, batch_size=32)
        )
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
