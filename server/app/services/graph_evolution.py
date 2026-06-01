import json
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.graph import TripleFeedback

logger = logging.getLogger(__name__)

SEED_EXAMPLES = [
    {
        "text": "RAG uses BGE-M3 for embedding, stored in pgvector vector database.",
        "entities": [
            {"name": "RAG", "type": "concept"},
            {"name": "BGE-M3", "type": "model"},
            {"name": "pgvector", "type": "tool"},
        ],
        "triples": [
            ["RAG", "uses", "BGE-M3"],
            ["BGE-M3", "example_of", "embedding model"],
            ["RAG", "uses", "pgvector"],
            ["pgvector", "example_of", "vector database"],
        ],
    },
    {
        "text": "Knowledge distillation transfers knowledge from large models to small models, reducing computational cost.",
        "entities": [
            {"name": "Knowledge distillation", "type": "method"},
            {"name": "large models", "type": "concept"},
            {"name": "small models", "type": "concept"},
        ],
        "triples": [
            ["Knowledge distillation", "uses", "large models"],
            ["Knowledge distillation", "extends", "small models"],
            ["large models", "example_of", "model"],
        ],
    },
    {
        "text": "GCN aggregates neighbor node features through adjacency matrix for semi-supervised learning.",
        "entities": [
            {"name": "GCN", "type": "method"},
            {"name": "adjacency matrix", "type": "concept"},
            {"name": "semi-supervised learning", "type": "method"},
        ],
        "triples": [
            ["GCN", "uses", "adjacency matrix"],
            ["GCN", "example_of", "semi-supervised learning"],
        ],
    },
]

BAD_EXAMPLES = [
    '["step one", "is", "vectorization"]',
    '["it", "uses", "database"]',
    '["RAG", "related to", "embedding"]',
]


class GraphEvolution:
    """Manages seed examples, few-shot prompt construction, and feedback-based evolution."""

    def build_few_shot_ner_prompt(self) -> str:
        """Build a few-shot prompt for named entity recognition."""
        examples_text = ""
        for ex in SEED_EXAMPLES[:3]:
            entities_str = json.dumps(ex["entities"], ensure_ascii=False)
            examples_text += f"\nText: {ex['text']}\nEntities: {entities_str}\n"

        return f"""You are a named entity recognition system specialized in technical content.

Good examples:
{examples_text}
Extract all named entities from the text. Entity types:
- concept: Technical concepts (e.g., RAG, Transformer)
- tool: Tools and frameworks (e.g., pgvector, Milvus)
- method: Methods and algorithms (e.g., cosine similarity, BM25)
- model: Model names (e.g., BGE-M3, GPT-4)

Return a JSON array. Each object has "name" and "type".
IMPORTANT: Return ONLY the JSON array."""

    def build_few_shot_re_prompt(self) -> str:
        """Build a few-shot prompt for relation extraction."""
        good = ""
        for ex in SEED_EXAMPLES[:3]:
            triples_str = json.dumps(ex["triples"], ensure_ascii=False)
            good += (
                f"\nText: {ex['text']}\n"
                f"Entities: {json.dumps([e['name'] for e in ex['entities']])}\n"
                f"Triples: {triples_str}\n"
            )

        bad_str = "\n".join(f"  AVOID: {b}" for b in BAD_EXAMPLES)

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
