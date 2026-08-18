"""Shared synthesis logic used by both topic-based and node-based synthesis."""

import json
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card, CardRelation
from app.models.chat import AiChat
from app.models.topology import NodeCard, NodeRef

# ── Synthesis mode prompts ──────────────────────────────────────────────

SYNTHESIS_PROMPTS: dict[str, str] = {
    "timeline": (
        "你是一个知识整理专家。请将以下零散的卡片笔记按时间线或逻辑发展顺序整理成一篇结构清晰的文章。"
        "保留原始信息的完整性，添加适当的过渡语句，使文章流畅连贯。"
        "使用 Markdown 格式，包含标题、小节和列表。"
    ),
    "argument": (
        "你是一个知识整理专家。请将以下零散的卡片笔记整理成一篇有论点-论据结构的文章。"
        "提炼核心观点，将相关卡片归类为支撑论据，形成有说服力的论述结构。"
        "使用 Markdown 格式，包含标题、小节和列表。"
    ),
    "comparison": (
        "你是一个知识整理专家。请将以下零散的卡片笔记按对比或分类方式整理成一篇结构化文章。"
        "识别卡片之间的异同点，按维度进行分类对比，形成清晰的对照结构。"
        "使用 Markdown 格式，包含标题、小节和列表。"
    ),
    "free": (
        "你是一个知识整理专家。请将以下零散的卡片笔记整理成一篇结构清晰、逻辑连贯的文章。"
        "自动识别最佳组织方式，提炼关键信息，消除重复，补充过渡。"
        "使用 Markdown 格式，包含标题、小节和列表。"
    ),
}


async def collect_subtree_card_ids(db: AsyncSession, node_id: UUID) -> list[UUID]:
    """Collect all card IDs from a node and all its descendants (recursive CTE)."""
    # Recursive CTE: start with the given node, then walk children
    descendants = (
        select(AiChat.id)
        .where(AiChat.id == node_id)
        .cte(name="descendants", recursive=True)
    )
    descendants = descendants.union_all(
        select(AiChat.id).where(AiChat.parent_id == descendants.c.id)
    )

    # Query NodeCard for all cards in the subtree
    result = await db.execute(
        select(NodeCard.card_id).where(
            NodeCard.chat_id.in_(select(descendants.c.id))
        )
    )
    return [row[0] for row in result.all()]


async def collect_subtree_node_ids(db: AsyncSession, node_id: UUID) -> list[UUID]:
    """Collect all node IDs in a subtree (including the root node)."""
    descendants = (
        select(AiChat.id)
        .where(AiChat.id == node_id)
        .cte(name="descendants", recursive=True)
    )
    descendants = descendants.union_all(
        select(AiChat.id).where(AiChat.parent_id == descendants.c.id)
    )
    result = await db.execute(select(descendants.c.id))
    return [row[0] for row in result.all()]


def build_card_content_block(cards: list[Card]) -> str:
    """Format cards into a content block for LLM synthesis."""
    card_texts = []
    for c in cards:
        title = c.title or "Untitled"
        card_texts.append(f"### {title}\n\n{c.content}")
    return "\n\n---\n\n".join(card_texts)


# ── Forest convergence: pass-2 refinement (VISION 理念6 两遍式第二遍) ──────

REFINE_SYSTEM_PROMPT = (
    "你是 MindCard 的知识收敛报告精修师。你将收到 agent 从知识森林走查得到的草稿。\n"
    "任务：把草稿精修为一份结构清晰、表达凝练的 Markdown 报告。\n"
    "要求：\n"
    "1. 忠实于草稿内容，不要编造草稿中不存在的信息。\n"
    "2. 改进结构与表达：清晰的标题层级、逻辑分段、要点化。\n"
    "3. 突出：主题概览、关键洞察、知识之间的关系、可进一步探索的方向。\n"
    "4. 如果提供了「森林思维特征统计」，请在报告末尾加入一节「思维模式分析」，"
    "解读这些统计反映了怎样的思考习惯（例如：是否善于深挖、是否善于连接、"
    "是否有孤立的想法、发散与聚焦的平衡）。\n"
    "5. 使用中文，Markdown 格式。"
)


async def compute_forest_stats(db: AsyncSession, ws_id: UUID) -> dict[str, Any]:
    """Compute deterministic thinking-pattern metrics from the topology forest.

    These numbers feed the refinement prompt's 「思维模式分析」 section (VISION
    理念9) — they describe *how* the user explores, not just what they wrote.
    """
    nodes = list((await db.execute(
        select(AiChat).where(
            AiChat.workspace_id == ws_id,
            AiChat.chat_status != "archived",
        )
    )).scalars().all())
    branches = [n for n in nodes if n.parent_id is not None]

    node_ids = [n.id for n in nodes]
    card_count_map: dict[UUID, int] = {}
    all_card_ids: list[UUID] = []
    if node_ids:
        rows = (await db.execute(
            select(NodeCard.chat_id, NodeCard.card_id).where(NodeCard.chat_id.in_(node_ids))
        )).all()
        for chat_id, card_id in rows:
            card_count_map[chat_id] = card_count_map.get(chat_id, 0) + 1
            all_card_ids.append(card_id)

    total_cards = len(set(all_card_ids))

    relation_count = 0
    if all_card_ids:
        relation_count = (await db.execute(
            select(func.count()).select_from(CardRelation).where(
                (CardRelation.card_id.in_(all_card_ids))
                | (CardRelation.related_card_id.in_(all_card_ids))
            )
        )).scalar() or 0

    ref_count = 0
    ref_node_ids: set[UUID] = set()
    if node_ids:
        ref_rows = (await db.execute(
            select(NodeRef.source_chat_id, NodeRef.target_chat_id).where(
                (NodeRef.source_chat_id.in_(node_ids)) | (NodeRef.target_chat_id.in_(node_ids))
            )
        )).all()
        ref_count = len(ref_rows)
        for s_id, t_id in ref_rows:
            ref_node_ids.add(s_id)
            ref_node_ids.add(t_id)

    max_depth = max((n.depth or 0) for n in nodes) if nodes else 0

    top_branches = sorted(
        ((n.title or "未命名", card_count_map.get(n.id, 0)) for n in branches),
        key=lambda x: x[1],
        reverse=True,
    )[:5]

    isolated_branches = [
        n.title or "未命名"
        for n in branches
        if n.id not in ref_node_ids and card_count_map.get(n.id, 0) < 2
    ][:5]

    return {
        "total_branches": len(branches),
        "max_depth": max_depth,
        "total_cards": total_cards,
        "card_relation_count": relation_count,
        "card_relation_density": round(relation_count / total_cards, 2) if total_cards else 0,
        "cross_branch_refs": ref_count,
        "top_branches": [{"title": t, "cards": c} for t, c in top_branches],
        "isolated_branches": isolated_branches,
    }


async def produce_synthesis(goal: str, draft: str, stats: dict[str, Any] | None = None) -> str:
    """Two-pass synthesis, pass 2: refine the agent's forest-walk draft with the
    stronger synthesis LLM. Falls back to the draft if the refinement model is
    unavailable or returns empty. `stats` are forest thinking-pattern metrics
    (VISION 理念9) injected for the 「思维模式分析」 section."""
    import logging

    from app.services.llm import get_llm_service
    from app.utils.usage import get_current_user_id, schedule_usage_record

    logger = logging.getLogger(__name__)
    service = get_llm_service()
    provider = service._build_synthesis_provider()
    provider_name = service.synthesis_provider_name
    logger.info("produce_synthesis: provider=%s, draft_len=%d", provider_name, len(draft))

    user_content = f"收敛目标：{goal}\n\nagent 走查草稿：\n{draft}"
    if stats:
        user_content += (
            "\n\n## 森林思维特征统计（用于「思维模式分析」）\n"
            + json.dumps(stats, ensure_ascii=False, indent=1)
        )

    messages = [
        {"role": "system", "content": REFINE_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    try:
        result = await provider.chat(messages, max_tokens=8192, temperature=0.4, timeout=120)
        schedule_usage_record(get_current_user_id(), result.usage)
        content = result.content.strip()
        return content if content else draft
    except Exception as e:
        logger.warning("produce_synthesis failed, falling back to draft: %s", e)
        return draft
