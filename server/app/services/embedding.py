import logging

import httpx

logger = logging.getLogger(__name__)


def current_model_tag() -> str:
    """Tag identifying the active embedding model, e.g. ``openai/BAAI/bge-m3``.

    Written into ``embedding_model`` columns whenever a vector is stored so
    mixed-model data can be detected and re-embedded after a model change.
    """
    from app.config import settings

    provider = settings.embedding_provider.strip().lower()
    return f"{provider}/{settings.embedding_model}"


class EmbeddingService:
    """Embedding service supporting Ollama (local) or OpenAI-compatible APIs.

    Provider is selected via ``embedding_provider`` in settings:
    - ``ollama`` (default): POST {base}/api/embed with bge-m3
    - ``openai``: POST {base}/embeddings (OpenAI-compatible, e.g. SiliconFlow BAAI/bge-m3)
    Both must output vectors matching ``embedding_dim`` (1024) since the DB
    columns are fixed to vector(1024).
    """

    def __init__(self) -> None:
        from app.config import settings
        self._provider = settings.embedding_provider.strip().lower()
        self._base_url = (settings.embedding_base_url or settings.ollama_base_url).rstrip("/")
        self._model = settings.embedding_model
        self._api_key = settings.embedding_api_key
        self._client: httpx.AsyncClient | None = None

    @property
    def model_tag(self) -> str:
        """Provider/model tag for the vectors this service generates."""
        return current_model_tag()

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=httpx.Timeout(120.0), trust_env=False)
        return self._client

    async def _embed_ollama(self, texts: list[str]) -> list[list[float]]:
        """Call Ollama embed API (POST {base}/api/embed)."""
        resp = await self._get_client().post(
            f"{self._base_url}/api/embed",
            json={"model": self._model, "input": texts},
        )
        resp.raise_for_status()
        return resp.json()["embeddings"]

    async def _embed_openai(self, texts: list[str]) -> list[list[float]]:
        """Call an OpenAI-compatible embeddings API (POST {base}/embeddings)."""
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        resp = await self._get_client().post(
            f"{self._base_url}/embeddings",
            headers=headers,
            json={"model": self._model, "input": texts},
        )
        resp.raise_for_status()
        data = resp.json()
        return [item["embedding"] for item in data["data"]]

    async def _embed_raw(self, texts: list[str]) -> list[list[float]]:
        """Generate raw embeddings via the configured provider."""
        try:
            if self._provider == "openai":
                return await self._embed_openai(texts)
            return await self._embed_ollama(texts)
        except Exception as e:
            logger.error(
                "Embedding API failed (provider=%s, base=%s): %s",
                self._provider, self._base_url, e,
            )
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
        chunk_size = 64
        all_embeddings: list[list[float]] = []
        for i in range(0, len(texts), chunk_size):
            chunk = texts[i : i + chunk_size]
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

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()


async def check_embedding_consistency() -> str | None:
    """Compare stored vector tags against the configured embedding model.

    Returns the dominant ``embedding_model`` tag found in ``cards`` (or None).
    Logs a WARNING when the stored vectors were produced by a different model
    than currently configured — a sign that retrieval quality may be degraded
    and re-embedding is needed. Called on startup.
    """
    from sqlalchemy import func, select

    from app.database import async_session
    from app.models.card import Card

    configured = current_model_tag()
    async with async_session() as db:
        rows = (
            await db.execute(
                select(Card.embedding_model, func.count())
                .where(Card.embedding.isnot(None))
                .group_by(Card.embedding_model)
            )
        ).all()

    if not rows:
        return None
    dominant_tag = max(rows, key=lambda r: r[1])[0]
    dominant = dominant_tag if isinstance(dominant_tag, str) else None
    if dominant and dominant != configured:
        logger.warning(
            "Embedding model drift: stored vectors tagged '%s', configured '%s' — "
            "mixed-model retrieval may degrade. Re-embedding recommended.",
            dominant, configured,
        )
    elif dominant is None:
        logger.info(
            "Stored vectors predate embedding_model tagging (NULL) — "
            "re-embedding will version them."
        )
    return dominant


embedding_service = EmbeddingService()
