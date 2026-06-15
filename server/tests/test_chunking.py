"""Tests for EmbeddingService.split_text_into_chunks()"""

import pytest

from app.services.embedding import EmbeddingService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _long_paragraph(n_chars: int, sentence_len: int = 80) -> str:
    """Build a paragraph made of '.' -terminated sentences of fixed length."""
    sentence = "a" * (sentence_len - 2) + ". "
    full, remainder = divmod(n_chars, len(sentence))
    return sentence * full + "a" * remainder


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_short_content_returns_single_chunk():
    """Content well under max_chars returns exactly one chunk."""
    title = "Short"
    content = "This is a brief note."
    result = EmbeddingService.split_text_into_chunks(title, content, ["kw"], max_chars=600)

    assert isinstance(result, list)
    assert len(result) == 1
    assert title in result[0]
    assert "kw" in result[0]


def test_long_content_splits_into_multiple_chunks():
    """~1500-char content split at max_chars=400 produces more than one chunk."""
    title = "Long Card"
    # Build several paragraphs that together exceed 400 chars.
    paragraphs = [f"Paragraph {i}: " + "word " * 20 for i in range(8)]
    content = "\n\n".join(paragraphs)

    result = EmbeddingService.split_text_into_chunks(title, content, [], max_chars=400)

    assert len(result) > 1, f"Expected multiple chunks, got {len(result)}: {result}"
    # Each chunk should be non-trivially sized.
    for chunk in result:
        assert len(chunk.strip()) >= 20


def test_each_chunk_contains_title():
    """Title appears in every returned chunk."""
    title = "My Title"
    paragraphs = [f"Section {i}: " + "text " * 25 for i in range(6)]
    content = "\n\n".join(paragraphs)

    result = EmbeddingService.split_text_into_chunks(title, content, [], max_chars=300)

    assert len(result) > 1, "Precondition: content must split into multiple chunks"
    for chunk in result:
        assert title in chunk, f"Title missing from chunk: {chunk!r}"


def test_keywords_only_in_last_chunk():
    """Keywords appear only in the last chunk when content splits."""
    title = "Card"
    paragraphs = [f"Topic {i}: " + "detail " * 20 for i in range(6)]
    content = "\n\n".join(paragraphs)
    keywords = ["unique_keyword_xyz"]

    result = EmbeddingService.split_text_into_chunks(title, content, keywords, max_chars=300)

    assert len(result) > 1, "Precondition: needs multiple chunks"
    # Keyword must appear in the last chunk.
    assert keywords[0] in result[-1], "Keyword not found in last chunk"
    # Keyword must NOT appear in any earlier chunk.
    for chunk in result[:-1]:
        assert keywords[0] not in chunk, f"Keyword incorrectly present in non-last chunk: {chunk!r}"


def test_empty_content_returns_single_chunk():
    """Empty content returns a single chunk (the fallback full-text path)."""
    # Use a title and keyword long enough that the result is non-trivially sized.
    title = "My Knowledge Card About Python"
    result = EmbeddingService.split_text_into_chunks(title, "", ["programming", "python"], max_chars=600)

    assert len(result) == 1
    assert title in result[0]


def test_chunk_min_length_filter():
    """Chunks shorter than 20 chars after stripping are excluded from the result."""
    # Craft content where splitting might create tiny fragments.
    # We inject tiny paragraphs next to large ones.
    long_para = "word " * 80  # ~400 chars
    tiny_para = "Hi"  # 2 chars — well below the 20-char minimum

    content = f"{long_para}\n\n{tiny_para}\n\n{long_para}"

    result = EmbeddingService.split_text_into_chunks("T", content, [], max_chars=500)

    for chunk in result:
        assert len(chunk.strip()) >= 20, f"Short chunk found: {chunk!r}"


def test_single_paragraph_over_limit_splits_on_sentence():
    """A single paragraph longer than max_chars is split on sentence boundaries."""
    title = "Sentence Split"
    # Build one big paragraph with clear '. ' boundaries.
    sentences = [f"This is sentence number {i} in the long paragraph" for i in range(20)]
    content = ". ".join(sentences) + "."

    assert len(content) > 600, "Precondition: content must exceed max_chars"

    result = EmbeddingService.split_text_into_chunks(title, content, [], max_chars=600)

    assert len(result) > 1, (
        f"Expected multiple chunks from sentence-level splitting, got {len(result)}"
    )


def test_max_chars_respected():
    """
    Content sections (excluding the title prefix) should stay <= max_chars.

    The title prefix adds overhead (len(title) + 1 for newline), so we
    allow chunk length <= max_chars + len(title) + 1 + len(meta_suffix) + 1.
    For simplicity here we use no keywords / emotion_tag.
    """
    title = "Heading"
    max_chars = 300
    paragraphs = [f"Paragraph {i}: " + "word " * 15 for i in range(10)]
    content = "\n\n".join(paragraphs)

    result = EmbeddingService.split_text_into_chunks(title, content, [], max_chars=max_chars)

    title_overhead = len(title) + 1  # title + newline
    for chunk in result[:-1]:  # last chunk may have metadata
        assert len(chunk) <= max_chars + title_overhead, (
            f"Non-last chunk too long ({len(chunk)} chars): {chunk!r}"
        )
