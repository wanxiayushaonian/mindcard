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
        "text": "伊凡·伊里奇一生追求虚假的社会生活，直到临终才领悟真实的生命意义。",
        "entities": [
            {"name": "伊凡·伊里奇", "type": "人物"},
            {"name": "虚假的社会生活", "type": "概念"},
            {"name": "真实的生命意义", "type": "概念"},
        ],
        "triples": [
            ["伊凡·伊里奇", "追求", "虚假的社会生活"],
            ["伊凡·伊里奇", "领悟", "真实的生命意义"],
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
        "text": "Ivan Ilyich pursued a superficial social life until his death revealed its meaninglessness.",
        "entities": [
            {"name": "Ivan Ilyich", "type": "person"},
            {"name": "superficial social life", "type": "concept"},
            {"name": "meaninglessness", "type": "concept"},
        ],
        "triples": [
            ["Ivan Ilyich", "pursued", "superficial social life"],
            ["death", "revealed", "meaninglessness"],
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
        """Build a domain-agnostic prompt for relation extraction."""
        if language == "zh":
            return """任务：从文本中提取已知实体之间的关系。

你将收到一段文本和一组已识别的实体。请找出这些实体之间在文本中体现的具体关系。

要求：
1. 头实体和尾实体必须来自给定实体列表（名称精确匹配）
2. 关系用文本中体现的动词或动词短语，简洁具体（2-6字）
3. 只提取文本中明确表达或直接可推断的关系
4. 只输出 JSON 数组，不要任何解释、分析或思考过程

输出格式：
[["实体A", "关系", "实体B"]]

示例（仅展示格式）：
输入实体：["小明", "清华大学", "计算机科学"]
输出：[["小明", "就读于", "清华大学"], ["小明", "主修", "计算机科学"]]

如果没有关系，输出：[]"""
        else:
            return """Task: Extract relations between known entities from text.

You will receive a text and a set of identified entities. Find specific relations between these entities as expressed in the text.

Requirements:
1. Head and tail entities must come from the given entity list (exact name match)
2. Use concise, specific verb phrases (2-4 words) reflecting the text
3. Only extract explicitly stated or directly inferable relations
4. Output ONLY a JSON array — no explanation, analysis, or thinking

Output format:
[["entityA", "relation", "entityB"]]

Example (format only):
Input entities: ["Alice", "MIT", "computer science"]
Output: [["Alice", "studies_at", "MIT"], ["Alice", "majors_in", "computer science"]]

If no relations found, output: []"""

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
