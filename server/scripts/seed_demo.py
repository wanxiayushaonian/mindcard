"""Simulate a real user exploring the knowledge forest with the AI.

Generates organic demo data through the REAL flow instead of hand-written
templates: multi-turn real-LLM conversations, natural forking (with proper
fork-divider messages so the frontend hierarchy renders), and cards sedimented
from the actual discussions (LLM-extracted, embedded, source-mounted).

Cost: ~20-30 DeepSeek LLM calls, a few minutes. Idempotent via --reset.

Usage (from server/):
    uv run python -m scripts.seed_demo          # build demo data
    uv run python -m scripts.seed_demo --reset  # rebuild
"""

import argparse
import asyncio
import json
import uuid

from sqlalchemy import select

from app.database import async_session
from app.models.card import Card, CardRelation
from app.models.chat import AiChat, ChatMessage
from app.models.topology import NodeRef
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.services.llm import get_llm_service

DEMO_WS_NAME = "机器学习知识森林"

TEACHER_SYSTEM = (
    "你是一位知识渊博、循循善诱的机器学习老师。用中文讲解，深入浅出，"
    "结合具体例子，适当引导学习者思考，回答要充实（200-400字），不要敷衍。"
)

# The "user's" exploration prompts per node (real exploration, not answers).
# Each node's first prompt is the question that triggered the fork from its parent.
TREE = {
    "title": "机器学习学习之旅",
    "user_prompts": [
        "我想系统学习机器学习，应该从哪里开始？",
        "我数学基础一般，但特别想搞懂神经网络和大模型，这块该怎么入手？",
    ],
    "children": [
        {
            "title": "深度学习基础",
            "user_prompts": [
                "为什么反向传播能有效训练很深的网络？梯度不会消失吗？",
                "卷积神经网络和注意力机制分别擅长什么？本质区别在哪？",
            ],
            "children": [
                {
                    "title": "注意力机制深挖",
                    "user_prompts": [
                        "注意力机制的数学本质到底是什么？为什么它对长序列这么有效？",
                    ],
                },
            ],
        },
        {
            "title": "LLM 与 Agent",
            "user_prompts": [
                "大语言模型是怎么学会说话的？预训练和指令微调分别做什么？",
                "那怎么让 LLM 变成能调用工具的 Agent？工具循环是怎么设计的？",
            ],
        },
        {
            "title": "知识工程实践",
            "user_prompts": [
                "怎么把学到的东西整理成自己的知识体系？卡片笔记法和知识图谱能结合吗？",
            ],
        },
    ],
}

EXTRACT_SYSTEM = (
    "你是 MindCard 的知识提炼助手。根据对话记录：\n"
    "1) 生成一句话节点摘要（概括这段对话的主题与收获）；\n"
    "2) 提炼 2-3 张知识卡片，每张承载一个独立知识点（title 简洁、content 是 150-250 字的讲解、"
    "keywords 是 3-4 个关键词）。\n"
    '只输出 JSON：{"summary": "...", "cards": [{"title": "...", "content": "...", "keywords": ["..."]}]}'
)

LINK_SYSTEM = (
    "你是 MindCard 的知识关系构建助手。根据卡片清单，找出应该建立关系的卡片对。"
    "关系类型：extends（延伸）、contradicts（矛盾）、related（相关）。\n"
    '只输出 JSON：{"relations": [{"card_a": "标题A", "card_b": "标题B", "relation_type": "extends", "reason": "一句话理由"}]}'
)

# Cross-branch references (deterministic — branch titles are known in advance)
NODE_REFS = [
    ("LLM 与 Agent", "深度学习基础", "extends", "Agent 依赖 Transformer 理解"),
    ("知识工程实践", "LLM 与 Agent", "related", "知识工程需要理解大模型能力边界"),
]


def _parse_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
    return json.loads(text.strip())


async def _ai_reply(messages: list[dict]) -> str:
    """Real LLM reply given the conversation context."""
    result = await get_llm_service().complete(messages, max_tokens=700, temperature=0.7, timeout=90)
    return result.content.strip()


async def _llm_json(system: str, user: str, max_tokens: int = 1400, retries: int = 3) -> dict:
    """Structured extraction (real LLM) with retry — transient empty/invalid
    responses are common with long structured outputs. Falls back to {} only
    after exhausting retries."""
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            result = await get_llm_service().complete_simple(
                system, user, max_tokens=max_tokens, temperature=0.4, timeout=120
            )
            return _parse_json(result)
        except Exception as e:
            last_err = e
            if attempt < retries:
                print(f"  ⚠ 结构化提取失败（第 {attempt}/{retries} 次），重试: {e}")
                await asyncio.sleep(2)  # brief backoff between retries
    print(f"  ⚠ 结构化提取失败，跳过: {last_err}")
    return {}


async def _run_conversation(db, chat: AiChat, node: dict) -> list[dict]:
    """Run a node's exploration: user prompts + real AI replies (committed)."""
    messages = [{"role": "system", "content": TEACHER_SYSTEM}]
    for prompt in node["user_prompts"]:
        messages.append({"role": "user", "content": prompt})
        db.add(ChatMessage(chat_id=chat.id, role="user", content=prompt))
        reply = await _ai_reply(messages)
        messages.append({"role": "assistant", "content": reply})
        db.add(ChatMessage(chat_id=chat.id, role="assistant", content=reply))
        await db.commit()
        print(f"  [{chat.title}] user: {prompt[:36]}…")
        print(f"  [{chat.title}] ai  : {reply[:60]}…")
    return messages


async def _summarize_and_sediment(db, chat: AiChat, messages: list[dict],
                                  ws_id: uuid.UUID, owner_id: uuid.UUID) -> list[Card]:
    """One LLM call → node summary + cards; embed and source-mount each card."""
    from app.services.embedding import current_model_tag, embedding_service
    from app.services.topology import topology_service

    transcript = "\n".join(
        f"{m['role']}: {m['content']}" for m in messages if m["role"] != "system"
    )
    data = await _llm_json(EXTRACT_SYSTEM, f"对话记录：\n{transcript[:5000]}")
    chat.summary = data.get("summary", "") or chat.title
    cards: list[Card] = []
    for c in data.get("cards", []):
        title = c.get("title", "").strip()
        content = c.get("content", "").strip()
        if not title or not content:
            continue
        card = Card(
            local_id=f"demo-card-{uuid.uuid4().hex[:10]}",
            workspace_id=ws_id,
            creator_id=owner_id,
            title=title,
            content=content,
            keywords=c.get("keywords", []),
            is_temp=False,
        )
        db.add(card)
        await db.flush()
        # Embed (local Ollama) + source-mount to the node it was born in
        text = embedding_service.card_to_text(card.title, card.content, card.keywords, "")
        card.embedding = await embedding_service.embed(text)
        card.embedding_model = current_model_tag()
        await topology_service.assign_card_to_node(db, card, chat.id)
        cards.append(card)
        print(f"  ✓ 沉淀卡片 [{chat.title}]: {card.title}")
    await db.commit()
    return cards


async def _link_cards(db, cards: list[Card]) -> None:
    """One LLM call: decide which cards should relate to each other."""
    if len(cards) < 2:
        return
    listing = "\n".join(f"- {c.title}: {c.content[:80]}" for c in cards)
    data = await _llm_json(LINK_SYSTEM, f"卡片清单：\n{listing}")
    by_title = {c.title: c for c in cards}
    for rel in data.get("relations", []):
        a, b = by_title.get(rel.get("card_a")), by_title.get(rel.get("card_b"))
        if a and b:
            db.add(CardRelation(card_id=a.id, related_card_id=b.id,
                                relation_type=rel.get("relation_type", "related"), score=0.8))
            print(f"  ✓ 关系: {a.title} --[{rel.get('relation_type')}]--> {b.title}")
    await db.commit()


async def _build_node(db, node: dict, parent: AiChat | None, ws_id: uuid.UUID,
                      owner_id: uuid.UUID, depth: int,
                      all_chats: list[AiChat], all_cards: list[Card]) -> AiChat:
    chat = AiChat(
        local_id=f"demo-{uuid.uuid4().hex[:12]}",
        workspace_id=ws_id,
        user_id=None,  # shared example content — visible to every member
        parent_id=parent.id if parent else None,
        title=node["title"],
        summary="",
        node_type="root" if parent is None else "branch",
        mode="rag",
        depth=depth,
    )
    db.add(chat)
    await db.flush()

    if parent:
        # fork-divider in the parent (frontend hierarchy renders from this)
        db.add(ChatMessage(
            chat_id=parent.id,
            role="fork-divider",
            content="",
            metadata_={
                "child_chat_id": str(chat.id),
                "branch_label": node["title"],
                "depth": depth,
                "parent_context_summary": parent.summary or "",
            },
        ))
        await db.commit()

    print(f"\n── 对话: {chat.title} (depth {depth})")
    messages = await _run_conversation(db, chat, node)
    cards = await _summarize_and_sediment(db, chat, messages, ws_id, owner_id)
    all_chats.append(chat)
    all_cards.extend(cards)

    for child in node.get("children", []):
        await _build_node(db, child, chat, ws_id, owner_id, depth + 1, all_chats, all_cards)

    return chat


async def _delete_workspace(ws_id: uuid.UUID) -> None:
    async with async_session() as db:
        node_ids = [r[0] for r in (await db.execute(select(AiChat.id).where(AiChat.workspace_id == ws_id))).all()]
        card_ids = [r[0] for r in (await db.execute(select(Card.id).where(Card.workspace_id == ws_id))).all()]
        if node_ids:
            await db.execute(NodeRef.__table__.delete().where(
                (NodeRef.source_chat_id.in_(node_ids)) | (NodeRef.target_chat_id.in_(node_ids))
            ))
            await db.execute(ChatMessage.__table__.delete().where(ChatMessage.chat_id.in_(node_ids)))
        if node_ids or card_ids:
            if node_ids:
                await db.execute(AiChat.__table__.delete().where(AiChat.id.in_(node_ids)))
            if card_ids:
                from app.models.topology import NodeCard
                await db.execute(NodeCard.__table__.delete().where(NodeCard.card_id.in_(card_ids)))
                await db.execute(CardRelation.__table__.delete().where(
                    (CardRelation.card_id.in_(card_ids)) | (CardRelation.related_card_id.in_(card_ids))
                ))
                await db.execute(Card.__table__.delete().where(Card.id.in_(card_ids)))
        await db.execute(WorkspaceMember.__table__.delete().where(WorkspaceMember.workspace_id == ws_id))
        await db.execute(Workspace.__table__.delete().where(Workspace.id == ws_id))
        await db.commit()


async def main() -> None:
    parser = argparse.ArgumentParser(description="Simulate real usage to build the demo knowledge forest")
    parser.add_argument("--reset", action="store_true", help="delete and rebuild the demo workspace")
    args = parser.parse_args()

    async with async_session() as db:
        owner_id = (await db.execute(select(User.id).limit(1))).scalar_one()

        existing = (await db.execute(select(Workspace).where(Workspace.name == DEMO_WS_NAME))).scalar_one_or_none()
        if existing:
            if not args.reset:
                print(f"已存在演示工作区「{DEMO_WS_NAME}」，跳过（--reset 可重建）")
                return
            print(f"重建：删除「{DEMO_WS_NAME}」…")
            await _delete_workspace(existing.id)

        ws = Workspace(
            local_id=f"demo-{uuid.uuid4().hex[:8]}",
            name=DEMO_WS_NAME,
            owner_id=owner_id,
            invite_code=uuid.uuid4().hex[:8],
            is_demo=True,
        )
        db.add(ws)
        await db.flush()
        all_users = (await db.execute(select(User.id))).scalars().all()
        for uid in all_users:
            db.add(WorkspaceMember(workspace_id=ws.id, user_id=uid, role="editor"))
        await db.commit()

        print("模拟真实使用生成数据（真实 LLM 对话，需几分钟）…")
        all_chats: list[AiChat] = []
        all_cards: list[Card] = []
        await _build_node(db, TREE, None, ws.id, owner_id, 0, all_chats, all_cards)

        print("\n── 建立卡片关系…")
        await _link_cards(db, all_cards)

        print("── 建立跨分支引用…")
        chat_by_title = {c.title: c for c in all_chats}
        for a, b, ref_type, reason in NODE_REFS:
            sa, sb = chat_by_title.get(a), chat_by_title.get(b)
            if sa and sb:
                db.add(NodeRef(source_chat_id=sa.id, target_chat_id=sb.id, ref_type=ref_type, reason=reason))
        await db.commit()

    from app.services.synthesis import compute_forest_stats

    async with async_session() as db:
        stats = await compute_forest_stats(db, ws.id)
    print("\n✅ 演示工作区已建立（真实 LLM 生成）")
    print(f"工作区: {DEMO_WS_NAME} (id={ws.id})")
    print(f"统计: {stats}")
    print("\n在 web 顶栏「合成」→ 森林收敛 输入目标即可走查这片森林")


if __name__ == "__main__":
    asyncio.run(main())
