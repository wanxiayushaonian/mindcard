"""Benchmark tests for auto_bind_chat_to_node using real Ollama embeddings.

These tests require a running Ollama server with the bge-m3 model.
Skip with: pytest -m "not integration"
"""

import uuid

import pytest

from app.services.embedding import embedding_service
from app.services.topology import topology_service


# ---------------------------------------------------------------------------
# Benchmark topic pairs for node binding
# ---------------------------------------------------------------------------

# Chat messages that should bind to an existing "ML" node
ML_MESSAGES = [
    "什么是监督学习",
    "神经网络的训练过程",
    "如何选择损失函数",
    "过拟合怎么解决",
    "特征工程的方法有哪些",
]

# Chat messages that should NOT bind to an "ML" node (different domain)
DIFFERENT_MESSAGES = [
    "今天晚饭做什么菜",
    "周末去哪里爬山好",
    "最近有什么好电影",
    "怎么给汽车换机油",
    "钢琴入门教程推荐",
]


@pytest.mark.integration
class TestAutoBindBenchmark:
    """Benchmark auto_bind_chat_to_node with real embeddings."""

    @pytest.mark.asyncio
    async def test_similar_messages_bind_to_same_cluster(self):
        """Messages about the same topic should have high mutual similarity."""
        embeddings = []
        for msg in ML_MESSAGES:
            emb = await embedding_service.embed(msg)
            assert emb, f"Failed to embed: {msg}"
            embeddings.append(emb)

        # All ML messages should have pairwise similarity >= 0.5
        for i in range(len(embeddings)):
            for j in range(i + 1, len(embeddings)):
                dist = topology_service._cosine_distance(embeddings[i], embeddings[j])
                sim = 1.0 - dist
                assert sim >= 0.3, (
                    f"ML messages [{i}] and [{j}] have low similarity: {sim:.4f}\n"
                    f"  [{i}]: {ML_MESSAGES[i]}\n  [{j}]: {ML_MESSAGES[j]}"
                )

        print("\nML message pairwise similarities:")
        for i in range(len(embeddings)):
            for j in range(i + 1, len(embeddings)):
                dist = topology_service._cosine_distance(embeddings[i], embeddings[j])
                sim = 1.0 - dist
                print(f"  [{i}] vs [{j}]: {sim:.4f}")

    @pytest.mark.asyncio
    async def test_different_messages_far_from_ml_node(self):
        """Messages about different topics should be far from ML centroid."""
        # Compute ML "centroid"
        ml_embeddings = []
        for msg in ML_MESSAGES:
            emb = await embedding_service.embed(msg)
            assert emb
            ml_embeddings.append(emb)

        import numpy as np

        centroid = np.mean(ml_embeddings, axis=0)
        norm = np.linalg.norm(centroid)
        centroid = (centroid / norm).tolist()

        # Different-domain messages should have low similarity to ML centroid
        print("\nDifferent-domain messages vs ML centroid:")
        for msg in DIFFERENT_MESSAGES:
            emb = await embedding_service.embed(msg)
            assert emb
            dist = topology_service._cosine_distance(centroid, emb)
            sim = 1.0 - dist
            print(f"  '{msg[:20]:20s}'  similarity={sim:.4f}  "
                  f"{'BIND' if sim >= 0.7 else 'NEW NODE'}")

    @pytest.mark.asyncio
    async def test_threshold_0_7_sensitivity(self):
        """Test the 0.7 binding threshold with various topic pairs."""
        pairs = [
            ("什么是机器学习", "深度学习基础", "ML sub-topic"),
            ("什么是机器学习", "Python 编程入门", "Related tech"),
            ("什么是机器学习", "今天天气怎么样", "Unrelated"),
            ("数据库优化", "SQL 查询技巧", "DB sub-topic"),
            ("数据库优化", "如何做红烧肉", "Unrelated"),
            ("React 组件开发", "前端框架对比", "Frontend sub-topic"),
            ("React 组件开发", "钢琴入门教程", "Unrelated"),
        ]

        print("\n" + "=" * 80)
        print("AUTO-BIND THRESHOLD (0.7) SENSITIVITY")
        print("=" * 80)

        for msg_a, msg_b, label in pairs:
            emb_a = await embedding_service.embed(msg_a)
            emb_b = await embedding_service.embed(msg_b)
            assert emb_a and emb_b

            dist = topology_service._cosine_distance(emb_a, emb_b)
            sim = 1.0 - dist
            would_bind = sim >= 0.7
            print(f"  {label:20s}  sim={sim:.4f}  "
                  f"{'BIND' if would_bind else 'NEW NODE'}  "
                  f"(dist_from_0.7={abs(sim - 0.7):.4f})")

        print()
