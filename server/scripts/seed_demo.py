"""Seed a demo workspace with realistic data following the product flow
(发散→沉淀→收敛): branch conversations (forks), sedimented cards mounted to
their source nodes, and a topology tree.

Uses the app's real service layer, so embeddings (local Ollama bge-m3),
source-mounted topology binding, and (with --full) topic/triple extraction all
run as in production — the data is "alive" (RAG-searchable, topology-bound).

Idempotent: skips if the demo workspace exists; --reset deletes and rebuilds.

Usage (from server/):
    uv run python -m scripts.seed_demo                # embed + source-mount
    uv run python -m scripts.seed_demo --full         # + topic + graph triples (LLM)
    uv run python -m scripts.seed_demo --reset        # rebuild
"""

import argparse
import asyncio
import uuid

from sqlalchemy import select

from app.database import async_session
from app.models.card import Card, CardRelation
from app.models.chat import AiChat, ChatMessage
from app.models.topology import NodeCard, NodeRef
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember

DEMO_WS_NAME = "机器学习知识森林"

# ── Demo content ─────────────────────────────────────────────────────────────

# Each node: title, summary, messages[(role, content)], cards[(title, content, keywords)], children[]
ROOT = {
    "title": "机器学习学习之旅",
    "summary": "从零系统学习机器学习：数学基础、神经网络、大模型与知识工程，一路发散的探索旅程。",
    "messages": [
        ("user", "我想系统学习机器学习，应该从哪里开始？"),
        ("assistant", "建议从数学基础（线性代数、概率论）入手，再学经典算法。你对哪个方向最感兴趣？"),
        ("user", "我特别想深入神经网络和大模型，感觉这块最前沿。"),
    ],
    "children": [
        {
            "title": "深度学习基础",
            "summary": "神经网络核心：反向传播、卷积、注意力机制，以及为什么它们有效。",
            "messages": [
                ("user", "反向传播到底是怎么计算梯度的？"),
                ("assistant", "链式法则：损失对每一层权重的偏导，从输出层逐层回传。"),
                ("user", "那注意力机制和卷积有什么区别？"),
            ],
            "cards": [
                ("反向传播", "通过链式法则逐层计算损失对权重的梯度。核心公式：∂L/∂w = ∂L/∂out · ∂out/∂w，从输出层反向逐层传播。", ["梯度", "神经网络"]),
                ("卷积神经网络", "通过局部感受野与权重共享提取空间特征，适合图像。核心操作：卷积核在输入上滑动。", ["CNN", "图像"]),
                ("注意力机制", "对输入序列各位置加权求和，权重由 query 与 key 的相似度决定。是 Transformer 的基础。", ["注意力", "Transformer"]),
            ],
        },
        {
            "title": "LLM 与 Agent",
            "summary": "大语言模型架构、工具调用循环，以及 agent 的上下文工程。",
            "messages": [
                ("user", "大模型的工具调用是怎么实现的？"),
                ("assistant", "模型输出结构化的 tool_call，系统执行后把结果回填上下文，形成循环。"),
                ("user", "那 agent 的记忆应该怎么设计？"),
            ],
            "children": [
                {
                    "title": "Agent 记忆设计",
                    "summary": "工作区记忆、记忆衰减与分支记忆：让 agent 记住跨会话的知识。",
                    "messages": [
                        ("user", "agent 怎么在多次对话里记住东西？"),
                        ("assistant", "用工作区记忆 + 记忆衰减：重要的事实长期保留，过期的自动归档。"),
                    ],
                    "cards": [
                        ("工作区记忆", "以 workspace 为粒度的共享记忆，包含 fact/claim 类型，带 embedding 参与 RAG 注入。", ["记忆", "agent"]),
                        ("记忆衰减", "两级遗忘：读取时计算衰减（base_importance × exp(-days/half_life)），低于阈值且过期的归档。", ["遗忘", "记忆"]),
                    ],
                },
            ],
            "cards": [
                ("LLM 架构", "Transformer 解码器堆叠 + 自回归生成。上下文窗口是核心资源，需要 token 预算管理。", ["LLM", "架构"]),
                ("Agent 工具循环", "模型输出 tool_call → 系统执行 → 结果回填 → 模型继续。工具注册表 + 事件流驱动。", ["agent", "工具"]),
            ],
        },
        {
            "title": "知识工程实践",
            "summary": "卡片笔记法、知识图谱与检索增强：把学到的整理成体系。",
            "messages": [
                ("user", "怎么把学习的东西整理成自己的知识体系？"),
                ("assistant", "卡片笔记法 + 知识图谱：每张卡片一个想法，用关系连接成网络。"),
            ],
            "cards": [
                ("卡片原子性", "每张卡片只承载一个想法。过大时应拆分，保持原子的、可复用的知识单元。", ["卡片笔记"]),
                ("知识图谱三元组", "以 (实体, 关系, 实体) 形式抽取知识，支持图检索推理。", ["图谱", "三元组"]),
            ],
        },
    ],
}

# (card_title_a, card_title_b, relation_type)
CARD_RELATIONS = [
    ("注意力机制", "反向传播", "extends"),
    ("LLM 架构", "注意力机制", "extends"),
    ("Agent 工具循环", "LLM 架构", "extends"),
    ("工作区记忆", "Agent 工具循环", "extends"),
    ("知识图谱三元组", "卡片原子性", "related"),
]

# (source_branch_title, target_branch_title, ref_type, reason)
NODE_REFS = [
    ("LLM 与 Agent", "深度学习基础", "extends", "Agent 依赖 Transformer 理解"),
    ("知识工程实践", "Agent 记忆设计", "related", "记忆系统是知识沉淀的基础"),
]

# ── Helpers ──────────────────────────────────────────────────────────────────


def _collect_nodes(node: dict) -> list[dict]:
    nodes = [node]
    for child in node.get("children", []):
        nodes.extend(_collect_nodes(child))
    return nodes


async def _delete_workspace(ws_id: uuid.UUID) -> None:
    """Explicitly delete children before the workspace (FK cleanup)."""
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
                await db.execute(NodeCard.__table__.delete().where(NodeCard.chat_id.in_(node_ids)))
            if card_ids:
                await db.execute(NodeCard.__table__.delete().where(NodeCard.card_id.in_(card_ids)))
                await db.execute(CardRelation.__table__.delete().where(
                    (CardRelation.card_id.in_(card_ids)) | (CardRelation.related_card_id.in_(card_ids))
                ))
                await db.execute(Card.__table__.delete().where(Card.id.in_(card_ids)))
        if node_ids:
            await db.execute(AiChat.__table__.delete().where(AiChat.id.in_(node_ids)))
        await db.execute(WorkspaceMember.__table__.delete().where(WorkspaceMember.workspace_id == ws_id))
        await db.execute(Workspace.__table__.delete().where(Workspace.id == ws_id))
        await db.commit()


async def _create_chat_tree(db, node: dict, workspace_id: uuid.UUID, owner_id: uuid.UUID,
                            parent_id: uuid.UUID | None, depth: int) -> AiChat:
    chat = AiChat(
        local_id=f"demo-{uuid.uuid4().hex[:12]}",
        workspace_id=workspace_id,
        user_id=owner_id,
        parent_id=parent_id,
        title=node["title"],
        summary=node["summary"],
        node_type="root" if parent_id is None else "branch",
        mode="rag",
        depth=depth,
    )
    db.add(chat)
    await db.flush()

    for role, content in node.get("messages", []):
        db.add(ChatMessage(chat_id=chat.id, role=role, content=content))
    await db.flush()

    for child in node.get("children", []):
        await _create_chat_tree(db, child, workspace_id, owner_id, chat.id, depth + 1)

    return chat


async def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the demo knowledge forest workspace")
    parser.add_argument("--full", action="store_true", help="run the complete background pipeline (topic + graph triples, uses LLM)")
    parser.add_argument("--reset", action="store_true", help="delete and rebuild the demo workspace")
    args = parser.parse_args()

    async with async_session() as db:
        # Owner = the first user in the DB (the local admin)
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
        # Share the demo workspace with every user so any logged-in account sees it
        all_users = (await db.execute(select(User.id))).scalars().all()
        for uid in all_users:
            db.add(WorkspaceMember(workspace_id=ws.id, user_id=uid, role="editor"))

        print("创建对话树（主线 + 分叉）…")
        await _create_chat_tree(db, ROOT, ws.id, owner_id, None, 0)
        await db.commit()

        # Build id maps: branch title → chat id; card title → card id
        nodes = _collect_nodes(ROOT)
        chat_by_title: dict[str, AiChat] = {}
        all_node_ids = (await db.execute(select(AiChat).where(AiChat.workspace_id == ws.id))).scalars().all()
        for n in all_node_ids:
            chat_by_title[n.title] = n

        # Create cards, embed, and source-mount
        print("创建卡片 + embedding + 源码挂载…")
        from app.services.embedding import current_model_tag, embedding_service
        from app.services.topology import topology_service

        card_by_title: dict[str, Card] = {}
        for node in nodes:
            for title, content, keywords in node.get("cards", []):
                card = Card(
                    local_id=f"demo-card-{uuid.uuid4().hex[:10]}",
                    workspace_id=ws.id,
                    creator_id=owner_id,
                    title=title,
                    content=content,
                    keywords=keywords,
                    is_temp=False,
                )
                db.add(card)
                await db.flush()

                if args.full:
                    # Full pipeline: embedding → topic → source-mount → triples (LLM)
                    from app.utils.card_tasks import _process_card

                    await _process_card(card.id, default_chat_id=chat_by_title[node["title"]].id, extraction_language="zh")
                else:
                    # Embed (local Ollama) + source-mount to the source branch
                    text = embedding_service.card_to_text(title, content, keywords, "")
                    card.embedding = await embedding_service.embed(text)
                    card.embedding_model = current_model_tag()
                    await topology_service.assign_card_to_node(
                        db, card, chat_by_title[node["title"]].id
                    )
                card_by_title[title] = card
                print(f"  ✓ {title} → {node['title']}")
        await db.commit()

        # Relations between cards
        print("建立卡片关系…")
        for a, b, rel_type in CARD_RELATIONS:
            ca, cb = card_by_title.get(a), card_by_title.get(b)
            if ca and cb:
                db.add(CardRelation(card_id=ca.id, related_card_id=cb.id, relation_type=rel_type, score=0.8))
        await db.commit()

        # Cross-branch refs
        print("建立跨分支引用…")
        for a, b, ref_type, reason in NODE_REFS:
            sa, sb = chat_by_title.get(a), chat_by_title.get(b)
            if sa and sb:
                db.add(NodeRef(source_chat_id=sa.id, target_chat_id=sb.id, ref_type=ref_type, reason=reason))
        await db.commit()

    # Final stats
    from app.services.synthesis import compute_forest_stats

    async with async_session() as db:
        stats = await compute_forest_stats(db, ws.id)
    print("\n✅ 演示工作区已建立")
    print(f"工作区: {DEMO_WS_NAME} (id={ws.id})")
    print(f"统计: {stats}")
    print("\n在 web 顶栏「合成」→ 森林收敛 输入目标即可走查这片森林")


if __name__ == "__main__":
    asyncio.run(main())
