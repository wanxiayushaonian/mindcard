import json
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.graph import TripleFeedback

logger = logging.getLogger(__name__)

SEED_EXAMPLES_ZH = [
    {
        "text": "RAG uses BGE-M3 for embedding, stored in pgvector vector database.",
        "entities": [
            {"name": "RAG", "type": "技术"},
            {"name": "BGE-M3", "type": "模型"},
            {"name": "pgvector", "type": "工具"},
            {"name": "embedding", "type": "概念"},
        ],
        "triples": [
            ["RAG", "uses", "BGE-M3"],
            ["BGE-M3", "is_a", "embedding model"],
            ["RAG", "uses", "pgvector"],
            ["pgvector", "stores", "embedding"],
        ],
    },
    {
        "text": "卡片笔记法通过双向链接构建知识网络，促进创新思考。",
        "entities": [
            {"name": "卡片笔记法", "type": "方法"},
            {"name": "双向链接", "type": "特性"},
            {"name": "知识网络", "type": "结构"},
            {"name": "创新思考", "type": "目标"},
        ],
        "triples": [
            ["卡片笔记法", "uses", "双向链接"],
            ["卡片笔记法", "builds", "知识网络"],
            ["知识网络", "enables", "创新思考"],
        ],
    },
    {
        "text": "GCN aggregates neighbor node features through adjacency matrix for semi-supervised learning.",
        "entities": [
            {"name": "GCN", "type": "算法"},
            {"name": "adjacency matrix", "type": "数据结构"},
            {"name": "semi-supervised learning", "type": "任务"},
        ],
        "triples": [
            ["GCN", "uses", "adjacency matrix"],
            ["GCN", "enables", "semi-supervised learning"],
        ],
    },
]

SEED_EXAMPLES_EN = [
    {
        "text": "RAG uses BGE-M3 for embedding, stored in pgvector vector database.",
        "entities": [
            {"name": "RAG", "type": "technology"},
            {"name": "BGE-M3", "type": "model"},
            {"name": "pgvector", "type": "tool"},
            {"name": "embedding", "type": "concept"},
        ],
        "triples": [
            ["RAG", "uses", "BGE-M3"],
            ["BGE-M3", "is_a", "embedding model"],
            ["RAG", "uses", "pgvector"],
            ["pgvector", "stores", "embedding"],
        ],
    },
    {
        "text": "Zettelkasten method builds knowledge network through bidirectional links, promoting creative thinking.",
        "entities": [
            {"name": "Zettelkasten method", "type": "method"},
            {"name": "bidirectional links", "type": "feature"},
            {"name": "knowledge network", "type": "structure"},
            {"name": "creative thinking", "type": "goal"},
        ],
        "triples": [
            ["Zettelkasten method", "uses", "bidirectional links"],
            ["Zettelkasten method", "builds", "knowledge network"],
            ["knowledge network", "enables", "creative thinking"],
        ],
    },
    {
        "text": "GCN aggregates neighbor node features through adjacency matrix for semi-supervised learning.",
        "entities": [
            {"name": "GCN", "type": "algorithm"},
            {"name": "adjacency matrix", "type": "data structure"},
            {"name": "semi-supervised learning", "type": "task"},
        ],
        "triples": [
            ["GCN", "uses", "adjacency matrix"],
            ["GCN", "enables", "semi-supervised learning"],
        ],
    },
]

BAD_EXAMPLES_ZH = [
    '["第一步", "是", "向量化"]',
    '["它", "使用", "数据库"]',
    '["RAG", "相关", "embedding"]',
]

BAD_EXAMPLES_EN = [
    '["step one", "is", "vectorization"]',
    '["it", "uses", "database"]',
    '["RAG", "related to", "embedding"]',
]


class GraphEvolution:
    """Manages seed examples, few-shot prompt construction, and feedback-based evolution."""

    def build_few_shot_ner_prompt(self, language: str = "zh") -> str:
        """Build a few-shot prompt for named entity recognition.

        Args:
            language: 'zh' for Chinese or 'en' for English
        """
        seed_examples = SEED_EXAMPLES_ZH if language == "zh" else SEED_EXAMPLES_EN

        examples_text = ""
        for ex in seed_examples[:3]:
            entities_str = json.dumps(ex["entities"], ensure_ascii=False)
            examples_text += f"\nText: {ex['text']}\nEntities: {entities_str}\n"

        if language == "zh":
            return f"""你是一个命名实体识别系统。

良好示例:
{examples_text}
从文本中提取所有重要实体。
对于每个实体，提供名称和最能描述它的类型。
类型应该直观且具有描述性（例如："概念"、"方法"、"工具"、"人物"、"作品"等）。
不要限制自己使用预定义类型 - 使用任何对实体有意义的类型。

返回一个 JSON 数组。每个对象有 "name" 和 "type"。
重要：只返回 JSON 数组，例如 [{{"name": "实体名", "type": "类型"}}]"""
        else:
            return f"""You are a named entity recognition system.

Good examples:
{examples_text}
Extract all important entities from the text.
For each entity, provide a name and a type that best describes it.
The type should be intuitive and descriptive (e.g., "concept", "method", "tool", "person", "work", etc.).
Don't limit yourself to predefined types - use whatever type makes sense for the entity.

Return a JSON array. Each object has "name" and "type".
IMPORTANT: Return ONLY the JSON array, e.g. [{{"name": "entity name", "type": "type"}}]"""

    def build_few_shot_re_prompt(self, language: str = "zh") -> str:
        """Build a few-shot prompt for relation extraction.

        Args:
            language: 'zh' for Chinese or 'en' for English
        """
        seed_examples = SEED_EXAMPLES_ZH if language == "zh" else SEED_EXAMPLES_EN
        bad_examples = BAD_EXAMPLES_ZH if language == "zh" else BAD_EXAMPLES_EN

        good = ""
        for ex in seed_examples[:3]:
            triples_str = json.dumps(ex["triples"], ensure_ascii=False)
            good += (
                f"\nText: {ex['text']}\n"
                f"Entities: {json.dumps(ex['entities'])}\n"
                f"Triples: {triples_str}\n"
            )

        bad_str = "\n".join(f"  AVOID: {b}" for b in bad_examples)

        if language == "zh":
            return f"""你是一个关系抽取系统。

良好示例:
{good}
不良模式（避免这些）:
{bad_str}

有效关系类型: contains, uses, depends_on, example_of, contradicts, extends

规则:
- 头实体和尾实体必须来自实体列表（精确匹配）
- 使用最具体的关系类型
- 只返回 JSON 数组 [头实体, 关系, 尾实体]
- 如果没有找到关系，返回 []"""
        else:
            return f"""You are a relation extraction system.

Good examples:
{good}
Bad patterns (avoid these):
{bad_str}

Valid relation types: contains, uses, depends_on, example_of, contradicts, extends

Rules:
- Head and tail MUST be from the entity list (exact match)
- Use the most specific relation type
- Return ONLY a JSON array of [head, relation, tail]
- If no relations found, return []"""

    async def collect_good_samples(
        self, workspace_id: uuid.UUID, db: AsyncSession, limit: int = 100
    ) -> list[dict]:
        """Collect positive feedback samples for few-shot example enrichment."""
        result = await db.execute(
            select(TripleFeedback)
            .where(TripleFeedback.feedback_type == "good")
            .order_by(TripleFeedback.created_at.desc())
            .limit(limit)
        )
        return [
            {"triple_id": str(fb.triple_id), "feedback_type": fb.feedback_type}
            for fb in result.scalars().all()
        ]

    async def analyze_bad_patterns(
        self, workspace_id: uuid.UUID, db: AsyncSession
    ) -> str:
        """Analyze negative feedback to identify common extraction problems."""
        result = await db.execute(
            select(TripleFeedback)
            .where(TripleFeedback.feedback_type == "bad")
            .order_by(TripleFeedback.created_at.desc())
            .limit(50)
        )
        bad_samples = result.scalars().all()
        if not bad_samples:
            return "No bad patterns found."

        from app.services.llm import llm_service

        sample_text = "\n".join(
            f"- feedback: {fb.feedback_type}, corrected: "
            f"head={fb.corrected_head}, "
            f"relation={fb.corrected_relation}, "
            f"tail={fb.corrected_tail}"
            for fb in bad_samples
        )

        response = await llm_service.complete_simple(
            system_prompt="Analyze bad triple extraction patterns and summarize the top 3 issues.",
            user_content=f"Bad triples:\n{sample_text}\n\nSummarize the common problems in 3 bullet points.",
        )
        return response


graph_evolution = GraphEvolution()
