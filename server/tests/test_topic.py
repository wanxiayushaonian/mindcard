"""Unit tests for TopicService pure functions."""

import math

import numpy as np
import pytest

from app.services.topic import TopicService


class TestCosineDistance:
    """Tests for _cosine_distance static method."""

    def test_identical_vectors(self):
        vec = [1.0, 0.0, 0.0]
        assert TopicService._cosine_distance(vec, vec) == pytest.approx(0.0)

    def test_orthogonal_vectors(self):
        a = [1.0, 0.0, 0.0]
        b = [0.0, 1.0, 0.0]
        assert TopicService._cosine_distance(a, b) == pytest.approx(1.0)

    def test_opposite_vectors(self):
        a = [1.0, 0.0, 0.0]
        b = [-1.0, 0.0, 0.0]
        assert TopicService._cosine_distance(a, b) == pytest.approx(2.0)

    def test_similar_vectors(self):
        a = [1.0, 0.0, 0.0]
        b = [0.9, 0.4359, 0.0]
        norm_b = math.sqrt(b[0] ** 2 + b[1] ** 2)
        b = [b[0] / norm_b, b[1] / norm_b, 0.0]
        dist = TopicService._cosine_distance(a, b)
        assert 0.0 < dist < 0.5

    def test_symmetry(self):
        a = [0.5, 0.5, 0.7071]
        b = [0.7071, 0.5, 0.5]
        assert TopicService._cosine_distance(a, b) == pytest.approx(
            TopicService._cosine_distance(b, a)
        )


class TestComputeThresholdFromEmbeddings:
    """Tests for _compute_threshold_from_embeddings static method."""

    def test_few_embeddings_returns_default(self):
        """With < 5 embeddings, returns default 0.45."""
        embeddings = [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]]
        assert TopicService._compute_threshold_from_embeddings(embeddings) == 0.45

    def test_empty_list_returns_default(self):
        assert TopicService._compute_threshold_from_embeddings([]) == 0.45

    def test_four_embeddings_returns_default(self):
        embeddings = [[1.0, 0.0]] * 4
        assert TopicService._compute_threshold_from_embeddings(embeddings) == 0.45

    def test_result_clamped_to_range(self):
        """Result should be in [0.2, 0.6]."""
        # Create embeddings with very high pairwise similarity (small distances)
        # This should produce a low threshold, clamped to 0.2
        rng = np.random.RandomState(42)
        base = rng.randn(1024).astype(np.float32)
        base /= np.linalg.norm(base)
        # All very similar to base
        embeddings = [(base + 0.01 * rng.randn(1024)).tolist() for _ in range(10)]
        # Normalize
        for i in range(len(embeddings)):
            arr = np.array(embeddings[i])
            embeddings[i] = (arr / np.linalg.norm(arr)).tolist()

        threshold = TopicService._compute_threshold_from_embeddings(embeddings)
        assert 0.2 <= threshold <= 0.6

    def test_five_identical_embeddings(self):
        """All identical -> distance 0 -> threshold 0 -> clamped to 0.2."""
        vec = [1.0, 0.0, 0.0]
        embeddings = [vec] * 5
        threshold = TopicService._compute_threshold_from_embeddings(embeddings)
        assert threshold == 0.2

    def test_five_orthogonal_pairs(self):
        """High distances -> high threshold, clamped to 0.6."""
        # Use orthogonal-ish vectors to get high distances
        embeddings = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
            [0.7071, 0.7071, 0.0, 0.0],
        ]
        threshold = TopicService._compute_threshold_from_embeddings(embeddings)
        assert 0.2 <= threshold <= 0.6


class TestKeywordsToName:
    """Tests for _keywords_to_name static method."""

    def test_empty_returns_未分类(self):
        assert TopicService._keywords_to_name([]) == "未分类"

    def test_single_keyword(self):
        assert TopicService._keywords_to_name(["Python"]) == "Python"

    def test_top_3_keywords(self):
        keywords = ["Python", "Java", "Go", "Rust", "Python", "Python", "Java"]
        result = TopicService._keywords_to_name(keywords)
        # Python appears 3 times, Java 2, Go 1, Rust 1
        assert result == "Python / Java / Go"

    def test_duplicates_only(self):
        keywords = ["AI", "AI", "AI"]
        assert TopicService._keywords_to_name(keywords) == "AI"

    def test_two_keywords(self):
        result = TopicService._keywords_to_name(["A", "B"])
        assert result == "A / B"

    def test_ordering_by_frequency(self):
        keywords = ["C", "A", "B", "A", "B", "A"]
        result = TopicService._keywords_to_name(keywords)
        assert result == "A / B / C"
