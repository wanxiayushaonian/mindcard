# RAG Pipeline

MindCard 的 RAG（Retrieval-Augmented Generation）系统是 AI 对话的核心，负责从知识库中检索相关上下文并注入 LLM prompt。

## 架构总览

```
用户提问
  ↓
RetrievalDispatcher（路由）
  ↓
┌─────────────────────────────────────────────┐
│  L0 CHAT    │ 纯 LLM，无检索               │
│  L1 SEARCH  │ 向量 + 全文混合检索           │
│  L2 EXPLORE │ 知识图谱遍历                  │
│  L3 CONTEXT │ 图遍历 + 拓扑路径             │
│  L4 INSIGHT │ 社区报告 Map-Reduce           │
└─────────────────────────────────────────────`
  ↓
Context Assembly（上下文组装）
  ↓
LLM Streaming（流式生成）
```

## 检索级别

### L0 — CHAT

纯 LLM 对话，不检索任何卡片。适用于闲聊、通用问题。

### L1 — SEARCH

**混合检索**：BGE-M3 向量搜索 + PostgreSQL 全文搜索，通过 RRF（Reciprocal Rank Fusion）融合。

**向量搜索**有两条路径：
- **Path A**：基于 `CardChunk` 的子文档嵌入，取每张卡片的最小余弦距离
- **Path B**：回退到 `Card.embedding` 的卡片级嵌入

**全文搜索**：优先使用 PostgreSQL `tsvector` + `plainto_tsquery('chinese')`，如果 zhparser/pg_jieba 扩展不可用则回退到 `ILIKE`。

**RRF 融合**：两个结果列表各取 2x limit，用 `score = Σ(1/(60 + rank))` 融合排序。

### L2 — EXPLORE

**图遍历检索**：从问题中提取实体 → 匹配图谱中的实体 → 1-2 hop 遍历 → 卡片评分。

评分逻辑：
- **0-hop（直接）**：通过 `EntityCard` 关联的卡片，得分 = 实体匹配置信度
- **1-hop**：邻居实体关联的卡片，得分 = `relation_weight × 0.3`
- **2-hop**：二跳邻居，得分衰减 = `base × rel_weight × 0.5`，阈值 0.02

**推理路径**：为每个匹配实体探索 top-3 出向关系，输出 `EntityA —[rel]→ EntityB —[rel]→ EntityC` 形式的推理链，最多 5 条。

如果图遍历无结果，回退到 L1 SEARCH。

### L3 — CONTEXT

在 L2 的基础上注入**拓扑路径上下文**（仅当 `RetrievalLevel.CONTEXT` 时生效）。

拓扑上下文由三部分组成：

**1. 探索路径（祖先链）**

从当前对话节点沿 `parent_id` 向上遍历（最多 20 跳），收集所有祖先节点的标题和摘要，反转后形成从根到当前的路径：

```
主线 → Transformer 研究 → Attention 机制探索 → 当前对话
```

这让 AI 理解"用户是怎么走到这个问题的"，从而给出更符合对话脉络的回答。

**2. 节点知识卡片**

当前拓扑节点关联的知识卡片标题（通过 `NodeCard` join table）。这些是用户在该探索路径上积累的相关知识。

**3. 交叉引用**

通过 `NodeRef` 表关联的其他拓扑节点，三种引用类型：
- `related`：相关联的探索分支
- `contradicts`：存在矛盾的分支
- `extends`：延伸/扩展的分支

格式示例：`Transformer 架构笔记 (关系: related)`

### L4 — INSIGHT

**Map-Reduce**：对 `CommunityReport` 进行 LLM 评分（并发限制 3），取 top-20 评分要点作为社区上下文。适用于全局性问题（"总览"、"全局"等关键词触发）。

## 上下文组装

System prompt 按以下顺序组装：

1. **格式指令** — Markdown 输出规范
2. **实体上下文** — 图遍历推理路径（最多 5 条）
3. **拓扑上下文** — 探索路径 + 节点卡片 + 交叉引用（L3 only）
4. **社区上下文** — 社区报告摘要（L4 only）
5. **卡片上下文** — `[标题]内容` 格式的检索卡片
6. **网络搜索** — 可选的 Web 搜索结果
7. **分支上下文** — 跨分支洞察 + 工作区记忆（所有级别）
8. **工具指令** — `create_fork` 和 `memory_edit` 工具说明

## 分支上下文详解

分支上下文（`build_branch_context`）包含两个独立的部分：**跨分支洞察**和**工作区记忆**。

### 跨分支洞察（BranchInsight）

当用户在多个分支中并行探索时，每个分支可能产生对其他分支有价值的发现。`BranchInsight` 就是分支间传递知识的机制。

**产生方式**：
- **自动产生**：`consolidation` 服务在对话结束后提取结构化洞察（最多 3 条），自动发送给所有**兄弟分支**（共享同一个 `parent_id` 的其他对话）
- **手动产生**：通过 API `POST /{chat_id}/insights` 手动发送

**消费方式**：
- 每次 `ask_stream` 时查询 `target_chat_id == 当前对话` 且 `consumed == False` 的洞察
- 格式化为 `<cross_branch_insights>` XML 标签注入 system prompt
- LLM 流式输出成功后才标记 `consumed = True`（使用 savepoint 保证事务安全）

**示例场景**：
```
主线对话
├─ 分支 A：探索 Transformer 架构
│   └─ 产生洞察："Attention 的计算复杂度是 O(n²)"
├─ 分支 B：探索 RNN 变体
│   └─ 自动收到分支 A 的洞察
│   └─ AI 回答时知道用户已在分支 A 了解了 Attention 的局限
```

### 工作区记忆（WorkspaceMemory）

与跨分支洞察不同，工作区记忆是**全局的** — 它属于整个工作区，不绑定特定分支。

**注入逻辑**：
- 查询当前工作区所有 `importance ≥ 0.3` 的记忆
- 按 `importance` 降序排列
- 每条记忆标注类型：`[事实]` / `[偏好]` / `[洞察]` / `[摘要]`
- 格式化为 `<shared_memory>` XML 标签

**与跨分支洞察的区别**：

| 维度 | 跨分支洞察 | 工作区记忆 |
|------|-----------|-----------|
| **范围** | 单个分支 → 单个分支 | 整个工作区 |
| **生命周期** | 消费后消失（consumed=True） | 永久存在 |
| **产生方式** | 自动（consolidation）或手动 | AI 工具（memory_edit）或手动 |
| **内容** | 对话中的临时发现 | 持久化的结构化知识 |
| **过滤** | 按目标对话匹配 | 按重要性过滤 |

## 自动检测

当用户未指定检索级别时（`AUTO_LEVEL = -1`），系统自动判断：

| 条件 | 路由 |
|------|------|
| 问题 < 10 字符 | SEARCH |
| 包含"总览"、"全局"等关键词 | INSIGHT |
| 包含"总结"、"关联"等关键词 | CONTEXT |
| 问题 embedding 匹配图谱实体名 | EXPLORE |
| 默认 | SEARCH |

## 嵌入模型

- **模型**：BGE-M3，通过 Ollama `/api/embed` 端点提供
- **分块**：`split_text_into_chunks(max_chars=600)`，段落分割 → 句子分割 → 贪心合并
- **每个分块**前置卡片标题以保证独立语义
- **关键词和情感标签**只附加到最后一个分块

## 前端展示

- **来源卡片**：AI 回答下方显示引用来源，可点击跳转
- **推理路径**：内联展示图遍历路径（可折叠）
- **上下文调试面板**：完整的检索元数据（级别、分数、实体、拓扑、系统 prompt）
- **LLM 引用指令**：system prompt 要求 LLM 用 `[卡片标题]` 标注来源

## 相关文件

| 文件 | 职责 |
|------|------|
| `server/app/services/rag.py` | RAG 主服务，上下文组装，流式生成 |
| `server/app/services/retrieval_dispatcher.py` | 检索级别路由，推理路径构建 |
| `server/app/services/search.py` | 混合搜索（向量 + 全文 + RRF） |
| `server/app/services/embedding.py` | BGE-M3 嵌入服务，文本分块 |
| `server/app/services/gnn_retriever.py` | 图遍历检索 |
| `server/app/schemas/retrieval.py` | 检索级别枚举，结果 schema |
