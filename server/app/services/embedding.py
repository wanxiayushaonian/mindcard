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

    @staticmethod
    def split_text_into_chunks(
        title: str,
        content: str,
        keywords: list[str],
        emotion_tag: str = "",
        max_chars: int = 600,
    ) -> list[str]:
        """Split card content into chunks for separate embedding.

        Returns a list of text chunks. Each chunk is self-contained with
        title prepended so that standalone retrieval is meaningful.
        If the assembled text is <= max_chars, returns a single chunk (same
        as card_to_text()). Otherwise splits on paragraph breaks (\\n\\n),
        keeping chunks under max_chars. Paragraphs longer than max_chars are
        split further on sentence boundaries ('. ' or '。'). Keywords and
        emotion_tag are appended only to the last chunk.
        """
        full_text = EmbeddingService.card_to_text(title, content, keywords, emotion_tag)

        # Fast path: fits in one chunk.
        if len(full_text) <= max_chars:
            return [full_text]

        # Build metadata suffix (appended to the last chunk only).
        meta_parts: list[str] = []
        if keywords:
            meta_parts.append(" ".join(keywords))
        if emotion_tag:
            meta_parts.append(emotion_tag)
        meta_suffix = " ".join(meta_parts)

        # Split content on blank lines to get paragraphs.
        raw_paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]

        # Further split any paragraph that individually exceeds max_chars on
        # sentence boundaries.
        paragraphs: list[str] = []
        for para in raw_paragraphs:
            if len(para) <= max_chars:
                paragraphs.append(para)
            else:
                # Split on '. ' or '。' boundaries.
                import re
                sentences = re.split(r"(?<=\. )|(?<=。)", para)
                current = ""
                for sentence in sentences:
                    if not sentence:
                        continue
                    if current and len(current) + len(sentence) > max_chars:
                        paragraphs.append(current.strip())
                        current = sentence
                    else:
                        current += sentence
                if current.strip():
                    paragraphs.append(current.strip())

        # Greedily join paragraphs into chunks that stay under max_chars.
        # Title prefix overhead is not counted in the limit — see docstring note.
        content_chunks: list[str] = []
        current_chunk = ""
        for para in paragraphs:
            if not current_chunk:
                current_chunk = para
            elif len(current_chunk) + 2 + len(para) <= max_chars:
                current_chunk += "\n\n" + para
            else:
                content_chunks.append(current_chunk)
                current_chunk = para
        if current_chunk:
            content_chunks.append(current_chunk)

        # Prepend title to each chunk and append metadata to the last chunk.
        title_prefix = f"{title}\n" if title else ""
        chunks: list[str] = []
        for i, section in enumerate(content_chunks):
            is_last = i == len(content_chunks) - 1
            if is_last and meta_suffix:
                chunk = f"{title_prefix}{section} {meta_suffix}"
            else:
                chunk = f"{title_prefix}{section}"
            chunks.append(chunk)

        # Filter out chunks that are too short to be meaningful.
        chunks = [c for c in chunks if len(c.strip()) >= 20]

        # Safety fallback.
        if not chunks:
            return [full_text]

        return chunks

    async def close(self):
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()


embedding_service = EmbeddingService()
