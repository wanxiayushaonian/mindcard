"""Benchmark tests for topic drift detection using real Ollama embeddings.

These tests require a running Ollama server with the bge-m3 model.
Skip with: pytest -m "not integration"
Run with:  pytest tests/test_drift_benchmark.py -v -s
"""

import math
import random

import pytest

from app.services.embedding import embedding_service
from app.services.topology import topology_service


# ---------------------------------------------------------------------------
# Benchmark topic pairs
# ---------------------------------------------------------------------------

# Should NOT drift (same domain, sub-topics)
NO_DRIFT_PAIRS: list[tuple[str, str, str]] = [
    ("机器学习的基本原理是什么", "深度学习和机器学习有什么区别", "ML sub-topics"),
    ("Python 的列表和元组有什么区别", "Python 字典的使用方法", "Python data structures"),
    ("如何优化数据库查询性能", "索引的工作原理是什么", "DB optimization"),
    ("FastAPI 的路由怎么定义", "FastAPI 中间件的使用方法", "FastAPI features"),
    ("什么是 RESTful API", "GraphQL 和 REST 的对比", "API paradigms"),
    ("神经网络的反向传播算法", "梯度下降的优化方法", "Neural net training"),
    ("Docker 容器的基本概念", "Docker Compose 的使用方法", "Docker ecosystem"),
    ("Git 分支管理策略", "Git rebase 和 merge 的区别", "Git workflows"),
    ("PostgreSQL 的事务隔离级别", "PostgreSQL 死锁的处理方法", "PostgreSQL internals"),
    ("React 的 useEffect 钩子", "React 的 useState 钩子", "React hooks"),
]

# Should drift (completely different domains)
DRIFT_PAIRS: list[tuple[str, str, str]] = [
    ("机器学习的基本原理是什么", "今天晚饭吃什么好", "ML vs food"),
    ("Python 的列表和元组有什么区别", "周末去哪里旅游比较好", "Python vs travel"),
    ("如何优化数据库查询性能", "最近有什么好看的电影", "DB vs movies"),
    ("FastAPI 的路由怎么定义", "明天天气怎么样", "FastAPI vs weather"),
    ("什么是 RESTful API", "如何保养汽车发动机", "API vs car"),
    ("神经网络的反向传播算法", "红楼梦的主要人物关系", "NN vs literature"),
    ("Docker 容器的基本概念", "健身房怎么练胸肌", "Docker vs fitness"),
    ("Git 分支管理策略", "怎么做红烧肉", "Git vs cooking"),
    ("PostgreSQL 的事务隔离级别", "今年的高考数学难吗", "PostgreSQL vs exam"),
    ("React 的 useEffect 钩子", "钢琴怎么学入门", "React vs piano"),
]

# Boundary pairs (near the 0.5 threshold, for sensitivity analysis)
BOUNDARY_PAIRS: list[tuple[str, str, str]] = [
    ("什么是机器学习", "什么是深度学习", "ML vs DL (close)"),
    ("Python 编程语言", "Java 编程语言", "Python vs Java"),
    ("前端开发框架", "后端开发框架", "Frontend vs backend"),
    ("数据库设计原则", "系统架构设计原则", "DB design vs arch design"),
    ("数据可视化方法", "数据分析方法", "Visualization vs analysis"),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    return float(sum(x * y for x, y in zip(a, b)))


async def embed_pair(text_a: str, text_b: str) -> tuple[list[float], list[float]]:
    """Embed both texts and return the vectors."""
    emb_a = await embedding_service.embed(text_a)
    emb_b = await embedding_service.embed(text_b)
    assert emb_a, f"Failed to embed: {text_a[:30]}..."
    assert emb_b, f"Failed to embed: {text_b[:30]}..."
    return emb_a, emb_b


# ---------------------------------------------------------------------------
# Benchmark tests
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestDriftBenchmark:
    """Benchmark drift detection with known topic pairs.

    Requires: Ollama running with bge-m3 model.
    """

    @pytest.mark.asyncio
    async def test_no_drift_pairs_should_not_fork(self):
        """All NO_DRIFT_PAIRS should have similarity >= 0.5 (no fork triggered)."""
        results = []
        for msg_a, msg_b, label in NO_DRIFT_PAIRS:
            emb_a, emb_b = await embed_pair(msg_a, msg_b)
            sim = cosine_similarity(emb_a, emb_b)
            should_drift = sim < 0.5
            results.append((label, sim, False, should_drift))

            # Assert: should NOT drift
            assert sim >= 0.5, (
                f"[{label}] Expected no drift but similarity={sim:.4f} < 0.5\n"
                f"  msg_a: {msg_a}\n  msg_b: {msg_b}"
            )

        # Print report
        print("\n" + "=" * 80)
        print("NO-DRIFT PAIRS (expect similarity >= 0.5)")
        print("=" * 80)
        for label, sim, expected_drift, actual_drift in results:
            status = "PASS" if not actual_drift else "FAIL"
            print(f"  [{status}] {label:30s}  similarity={sim:.4f}")
        print()

    @pytest.mark.asyncio
    async def test_drift_pairs_should_fork(self):
        """All DRIFT_PAIRS should have similarity < 0.5 (fork triggered)."""
        results = []
        for msg_a, msg_b, label in DRIFT_PAIRS:
            emb_a, emb_b = await embed_pair(msg_a, msg_b)
            sim = cosine_similarity(emb_a, emb_b)
            should_drift = sim < 0.5
            results.append((label, sim, True, should_drift))

            # Assert: should drift
            assert sim < 0.5, (
                f"[{label}] Expected drift but similarity={sim:.4f} >= 0.5\n"
                f"  msg_a: {msg_a}\n  msg_b: {msg_b}"
            )

        # Print report
        print("\n" + "=" * 80)
        print("DRIFT PAIRS (expect similarity < 0.5)")
        print("=" * 80)
        for label, sim, expected_drift, actual_drift in results:
            status = "PASS" if actual_drift else "FAIL"
            print(f"  [{status}] {label:30s}  similarity={sim:.4f}")
        print()

    @pytest.mark.asyncio
    async def test_similarity_distribution_report(self):
        """Generate a full similarity distribution report for all pairs."""
        all_results = []

        for msg_a, msg_b, label in NO_DRIFT_PAIRS:
            emb_a, emb_b = await embed_pair(msg_a, msg_b)
            sim = cosine_similarity(emb_a, emb_b)
            all_results.append((label, sim, "no_drift", sim >= 0.5))

        for msg_a, msg_b, label in DRIFT_PAIRS:
            emb_a, emb_b = await embed_pair(msg_a, msg_b)
            sim = cosine_similarity(emb_a, emb_b)
            all_results.append((label, sim, "drift", sim < 0.5))

        # Calculate accuracy
        correct = sum(1 for _, _, _, ok in all_results if ok)
        total = len(all_results)
        accuracy = correct / total if total > 0 else 0

        # Print full report
        print("\n" + "=" * 80)
        print("DRIFT DETECTION BENCHMARK REPORT")
        print("=" * 80)
        print(f"\nTotal pairs: {total}")
        print(f"Correct predictions: {correct}")
        print(f"Accuracy: {accuracy:.1%}")
        print(f"Drift threshold: 0.5")
        print()

        # Group by category
        no_drift_results = [(l, s, e, ok) for l, s, e, ok in all_results if e == "no_drift"]
        drift_results = [(l, s, e, ok) for l, s, e, ok in all_results if e == "drift"]

        no_drift_correct = sum(1 for _, _, _, ok in no_drift_results if ok)
        drift_correct = sum(1 for _, _, _, ok in drift_results if ok)

        print(f"No-drift accuracy: {no_drift_correct}/{len(no_drift_results)}")
        print(f"Drift accuracy:    {drift_correct}/{len(drift_results)}")

        # Similarity ranges
        sims = [s for _, s, _, _ in all_results]
        no_drift_sims = [s for _, s, e, _ in all_results if e == "no_drift"]
        drift_sims = [s for _, s, e, _ in all_results if e == "drift"]

        print(f"\nSimilarity range (all):       [{min(sims):.4f}, {max(sims):.4f}]")
        print(f"Similarity range (no-drift):  [{min(no_drift_sims):.4f}, {max(no_drift_sims):.4f}]")
        print(f"Similarity range (drift):     [{min(drift_sims):.4f}, {max(drift_sims):.4f}]")

        # Find the largest gap between min(no-drift) and max(drift)
        min_no_drift = min(no_drift_sims)
        max_drift = max(drift_sims)
        gap = min_no_drift - max_drift
        print(f"\nSafety margin: {gap:.4f}")
        if gap > 0:
            print(f"  -> No-drift min ({min_no_drift:.4f}) > Drift max ({max_drift:.4f})")
            print(f"  -> Threshold 0.5 is in a clear zone")
        else:
            print(f"  -> OVERLAP: Drift max ({max_drift:.4f}) >= No-drift min ({min_no_drift:.4f})")
            print(f"  -> Some pairs may be misclassified near threshold")

        print("\n" + "=" * 80)

        # The benchmark should have reasonable accuracy
        assert accuracy >= 0.8, f"Benchmark accuracy {accuracy:.1%} is below 80%"

    @pytest.mark.asyncio
    async def test_boundary_sensitivity(self):
        """Test pairs near the 0.5 threshold to measure sensitivity."""
        print("\n" + "=" * 80)
        print("BOUNDARY PAIR SENSITIVITY ANALYSIS")
        print("=" * 80)

        for msg_a, msg_b, label in BOUNDARY_PAIRS:
            emb_a, emb_b = await embed_pair(msg_a, msg_b)
            sim = cosine_similarity(emb_a, emb_b)
            would_drift = sim < 0.5
            distance_from_threshold = abs(sim - 0.5)

            print(f"  {label:35s}  sim={sim:.4f}  "
                  f"{'DRIFT' if would_drift else 'NO-DRIFT'}  "
                  f"distance_from_0.5={distance_from_threshold:.4f}")

        print()

    @pytest.mark.asyncio
    async def test_threshold_tuning_report(self):
        """Test multiple thresholds to find the optimal one."""
        all_pairs = []
        for msg_a, msg_b, label in NO_DRIFT_PAIRS:
            emb_a, emb_b = await embed_pair(msg_a, msg_b)
            sim = cosine_similarity(emb_a, emb_b)
            all_pairs.append((sim, False))  # should NOT drift

        for msg_a, msg_b, label in DRIFT_PAIRS:
            emb_a, emb_b = await embed_pair(msg_a, msg_b)
            sim = cosine_similarity(emb_a, emb_b)
            all_pairs.append((sim, True))  # SHOULD drift

        print("\n" + "=" * 80)
        print("THRESHOLD TUNING ANALYSIS")
        print("=" * 80)

        best_threshold = 0.5
        best_accuracy = 0

        for threshold_x10 in range(20, 70):  # 0.2 to 0.7
            threshold = threshold_x10 / 100.0
            correct = 0
            for sim, should_drift in all_pairs:
                predicted_drift = sim < threshold
                if predicted_drift == should_drift:
                    correct += 1
            accuracy = correct / len(all_pairs)
            marker = " <-- current" if abs(threshold - 0.5) < 0.01 else ""
            marker = " <-- BEST" if accuracy > best_accuracy else marker
            if abs(threshold - 0.5) < 0.01:
                marker = " <-- current"
            if accuracy > best_accuracy:
                best_accuracy = accuracy
                best_threshold = threshold
            print(f"  threshold={threshold:.2f}  accuracy={accuracy:.1%}  "
                  f"({correct}/{len(all_pairs)}){marker}")

        print(f"\nOptimal threshold: {best_threshold:.2f} (accuracy={best_accuracy:.1%})")
        print(f"Current threshold: 0.50")
        print("=" * 80)


@pytest.mark.integration
class TestCosineDistanceFunction:
    """Verify the _cosine_distance implementation against known values."""

    def test_identical_vectors(self):
        """Distance between identical vectors should be 0."""
        vec = [1.0, 0.0, 0.0]
        assert topology_service._cosine_distance(vec, vec) == pytest.approx(0.0)

    def test_orthogonal_vectors(self):
        """Distance between orthogonal vectors should be 1.0."""
        a = [1.0, 0.0, 0.0]
        b = [0.0, 1.0, 0.0]
        assert topology_service._cosine_distance(a, b) == pytest.approx(1.0)

    def test_opposite_vectors(self):
        """Distance between opposite vectors should be 2.0."""
        a = [1.0, 0.0, 0.0]
        b = [-1.0, 0.0, 0.0]
        assert topology_service._cosine_distance(a, b) == pytest.approx(2.0)

    def test_similar_vectors(self):
        """Vectors with high cosine similarity should have small distance."""
        a = [1.0, 0.0, 0.0]
        b = [0.9, 0.4359, 0.0]  # ~cos(25deg), sin(25deg), normalized
        norm_b = math.sqrt(b[0] ** 2 + b[1] ** 2)
        b = [b[0] / norm_b, b[1] / norm_b, 0.0]
        dist = topology_service._cosine_distance(a, b)
        assert 0.0 < dist < 0.5  # Similar but not identical

    def test_symmetry(self):
        """Distance should be symmetric: d(a,b) == d(b,a)."""
        a = [0.5, 0.5, 0.7071]
        b = [0.7071, 0.5, 0.5]
        assert topology_service._cosine_distance(a, b) == pytest.approx(
            topology_service._cosine_distance(b, a)
        )
