# 对话驱动的拓扑知识系统

**日期**: 2026-05-31
**分支**: feat/knowledge-topology
**状态**: 设计已通过

## 问题描述

用户在与 AI 进行长时间对话时会产生认知过载 — 知识变得碎片化，缺乏结构化的方式将洞察累积起来。当前 MindCard 系统拥有卡片、RAG 检索和拓扑树，但这些组件之间的连接是松散的。拓扑树通过 embedding 相似度对卡片进行分类，但无法反映用户实际的探索路径。

## 核心设计原则

**对话即拓扑。** 拓扑树不是一个独立的分类系统 — 它是用户通过对话进行知识探索的结构化轨迹。每一次分叉就是一个分支，每一个对话就是一个节点，卡片是挂在树上的叶与果。

## 关键决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 知识积累 vs 知识检索 | 结构化积累 | 核心目标是构建知识框架，而非仅仅搜索 |
| 拓扑节点的含义 | 对话轨迹 | 每个节点 = 一次具体探索，而非话题分类 |
| 分叉机制 | 用户手动触发 | 先做简单版，后续再考虑意图识别 |
| 路径感知 | 有价值 | 用户应知道自己在知识地图中的位置 |
| 对话 ↔ 节点映射 | 确定性（1:1） | 每个对话只属于一个节点 |
| 起始位置 | 根节点 | 主对话从工作空间根节点开始 |
| 卡片分类 | 双重机制：对话默认 + embedding 微调 | 确定性放置与智能调整相结合 |

## 架构设计

### 数据模型变更

#### AiChat ↔ 拓扑节点绑定

为 `AiChat` 添加 `tree_node_id` 字段：

```python
class AiChat(Base):
    # ... 已有字段 ...
    tree_node_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tree_nodes.id"), nullable=True
    )
    tree_node: Mapped["TreeNode"] = relationship(back_populates="chats")
```

#### TreeNode 简化

将 `branch`/`leaf` 合并为单一的 `topic` 类型：

- `root`：工作空间级别的根节点，每个工作空间一个
- `topic`：由对话分叉创建的节点

为 `TreeNode` 添加 `chat_id` 字段，追踪是哪个对话创建了该节点：

```python
class TreeNode(Base):
    # ... 已有字段 ...
    node_type: Mapped[str]  # 'root' | 'topic'（移除 'branch'/'leaf'）
    chat_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ai_chats.id"), nullable=True
    )
    chat: Mapped["AiChat"] = relationship(back_populates="tree_node")
```

### 分叉 → 创建子节点

用户分叉对话时：

1. 在父对话所在节点下创建子 `TreeNode`
2. 创建新的 `AiChat`，其 `tree_node_id` 指向新节点
3. 将父对话的近期消息 + 已沉淀卡片的摘要作为上下文传入

```
用户在对话 A 中（节点：RAG）
  → 分叉 "向量检索"
    → 在 RAG 下创建子节点 "向量检索"
    → 创建对话 B 绑定到新节点
    → 上下文 = A 的近期消息
```

### 卡片归属

**默认路径**：对话 X 中创建的卡片 → 归属到 X 的 `tree_node_id`

**embedding 微调**：卡片创建后，embedding 分类仍然运行：
- 若卡片内容与当前节点匹配（余弦距离 < 阈值）→ 留在当前节点
- 若卡片内容更匹配兄弟/子节点 → 静默自动移动（对话上下文是软默认，embedding 是硬覆盖）

实现：修改 `topology_service.assign_card_to_node()`，增加可选参数 `default_node_id`。当提供 `default_node_id` 时，以此为起点，但仍允许 embedding 覆盖。

### 迁移策略

已有的、没有 `tree_node_id` 的对话保持原样，继续正常工作但不绑定拓扑。新对话和分叉对话自动绑定。

### 路径感知（面包屑导航）

API：`GET /api/chat/{chat_id}/path` 返回从根节点到当前节点的路径：

```json
{
  "path": [
    {"node_id": "...", "title": "知识探索", "chat_id": "..."},
    {"node_id": "...", "title": "RAG", "chat_id": "..."},
    {"node_id": "...", "title": "向量检索", "chat_id": "..."}
  ]
}
```

前端：在对话面板顶部显示面包屑导航 `根节点 > RAG > 向量检索`，每段可点击跳转到祖先对话。

### 拓扑树生长

拓扑树从对话分叉中自然生长：
- 不需要独立的拓扑管理界面
- 3D 可视化展示完整的探索地图
- 3D 视图中每个节点可点击，直接打开对应对话

## 实现顺序

1. **数据模型**：为 `AiChat` 添加 `tree_node_id`，为 `TreeNode` 添加 `chat_id`，简化 `node_type`
2. **分叉集成**：修改 `POST /chat/{id}/fork`，使其自动创建子拓扑节点
3. **卡片归属**：修改卡片创建逻辑，使用对话所在节点作为默认归属
4. **路径 API**：新增 `GET /chat/{chat_id}/path` 端点
5. **前端面包屑**：在对话面板中显示路径导航
6. **3D 视图集成**：点击节点 → 打开对应对话

## 暂不考虑（未来）

- 自动意图识别 agent 实现自动分叉
- 多 agent 架构与子智能体
- 拓扑树内的卡片互链
- 协作式拓扑探索
