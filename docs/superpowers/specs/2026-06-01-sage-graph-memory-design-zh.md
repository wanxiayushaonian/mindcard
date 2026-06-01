# SAGE 图记忆系统集成设计

**日期**: 2026-06-01
**分支**: feat/knowledge-topology
**状态**: 设计讨论中

## 问题描述

当前 MindCard 的检索系统基于传统 RAG（embedding 余弦相似度 + 全文搜索 RRF 融合），存在以下局限：

1. **单跳检索**：每次查询独立，无法从部分线索恢复完整证据链
2. **无记忆**：系统不知道上次检索了什么、用户觉得哪些有用
3. **无反馈**：检索质量无法从使用中改进
4. **关系缺失**：卡片之间只有"相似"关系，没有精确的语义关系（包含、依赖、矛盾）
5. **技术深度不足**：传统 RAG 已过时，缺乏学术前沿技术

## 核心设计原则

**从静态检索升级为自进化图记忆。** 借鉴 SAGE（Self-Evolving Agentic Graph-Memory Engine）的设计思想，将卡片内容分解为实体-关系三元组，构建动态知识图谱，通过 GNN（图神经网络）实现多跳推理检索，并通过读写器闭环实现自进化。

## 关键决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 三元组抽取方式 | LLM 两步流水线（NER → RE） | 技术领域实体需要语义理解，传统 NLP 覆盖不足 |
| 图存储 | PostgreSQL（entities + relations + entity_cards） | 复用现有基础设施，无需引入图数据库 |
| 检索方式 | GNN（SAGERetriever）+ embedding 回退 | 多跳推理能力，新卡片用 embedding 保底 |
| GNN 训练时机 | 定期批量（每周 OR 每 100 张卡片） | 平衡动态图与训练成本 |
| 训练模式 | 本地 CPU / 本地 GPU / 云端 GPU 三选一 | 适配不同硬件条件 |
| 自进化机制 | Few-shot 示例 + 用户反馈 + 示例池更新 | 比 SFT 训练轻量，比纯 prompt 优化有效 |
| 与拓扑树关系 | 单向链接（拓扑节点标记核心实体） | 保持拓扑树简洁，通过实体标签建立关联 |

## 架构设计

### 整体数据流

```
卡片创建 → 两步 LLM 抽取三元组 → 写入图存储（PostgreSQL）
                                    ↓
                              定期 GNN 训练（PyTorch Geometric）
                                    ↓
用户提问 → 实体识别 → GNN 检索（已训练）/ Embedding 回退（新卡片）
         → 子图收集 → 回溯源卡片 → 排序返回
                                    ↓
                              用户交互反馈 → 调整关系权重
                                    ↓
                              自进化：评估三元组质量 → 改进抽取 prompt
```

### 数据模型

#### 新增表结构

```sql
-- 实体表
CREATE TABLE graph_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    entity_type TEXT,  -- 'concept', 'tool', 'method', 'model' 等
    embedding VECTOR(768),  -- BGE-M3 embedding
    access_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_graph_entities_workspace ON graph_entities(workspace_id);
CREATE INDEX idx_graph_entities_embedding ON graph_entities USING ivfflat (embedding vector_cosine_ops);

-- 关系表
CREATE TABLE graph_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    head_id UUID NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
    relation TEXT NOT NULL,
    tail_id UUID NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
    weight FLOAT DEFAULT 1.0,  -- 反馈权重，初始 1.0
    source_card_id UUID REFERENCES cards(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_graph_relations_workspace ON graph_relations(workspace_id);
CREATE INDEX idx_graph_relations_head ON graph_relations(head_id);
CREATE INDEX idx_graph_relations_tail ON graph_relations(tail_id);

-- 实体-卡片映射（一个实体可出现在多张卡片中）
CREATE TABLE entity_cards (
    entity_id UUID NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
    card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    PRIMARY KEY (entity_id, card_id)
);

-- GNN 训练记录
CREATE TABLE gnn_training_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    training_mode TEXT NOT NULL,  -- 'local_cpu', 'local_gpu', 'remote_gpu'
    graph_size_nodes INT NOT NULL,
    graph_size_edges INT NOT NULL,
    checkpoint_path TEXT NOT NULL,
    training_duration_seconds INT,
    status TEXT NOT NULL,  -- 'running', 'completed', 'failed'
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

#### 拓扑树扩展

```sql
-- 为拓扑节点添加核心实体标记
ALTER TABLE tree_nodes ADD COLUMN core_entity_ids UUID[] DEFAULT '{}';
```

### 模块一：三元组抽取（Memory Writer）

借鉴 SAGE 的 `LLMOPENIEModel` 两步流水线。

#### Step 1 — NER（命名实体识别）

**Prompt 模板**：
```
从以下文本中抽取所有命名实体，包括：
- 技术概念（如 RAG、Transformer）
- 工具和框架（如 pgvector、Milvus）
- 方法和算法（如余弦相似度、BM25）
- 模型名称（如 BGE-M3、GPT-4）

返回 JSON 数组格式，每个实体包含 name 和 type。

文本：
{card_content}

输出格式：
[
  {"name": "RAG", "type": "concept"},
  {"name": "pgvector", "type": "tool"},
  ...
]
```

#### Step 2 — RE（关系抽取）

**Prompt 模板**：
```
给定以下实体列表和原文，抽取实体之间的关系三元组。

实体列表：
{entities}

原文：
{card_content}

关系类型包括但不限于：
- 包含（A 包含 B）
- 使用（A 使用 B）
- 依赖（A 依赖 B）
- 举例（A 举例 B）
- 矛盾（A 矛盾 B）
- 扩展（A 扩展 B）

返回 JSON 数组格式，每个三元组为 [head, relation, tail]。

输出格式：
[
  ["RAG", "包含", "embedding 模型"],
  ["RAG", "使用", "余弦相似度"],
  ...
]
```

#### 实体链接（Entity Linking）

新实体产生后，用 BGE-M3 embedding 与已有实体做余弦相似度：
- 相似度 > 0.85：合并为同一实体，保留访问次数最多的名称
- 相似度 ≤ 0.85：创建新实体

**实现**：
```python
async def link_entity(workspace_id: UUID, entity_name: str, embedding: list[float]) -> UUID:
    # 查找相似实体
    similar = await db.execute(
        select(GraphEntity)
        .where(GraphEntity.workspace_id == workspace_id)
        .order_by(GraphEntity.embedding.cosine_distance(embedding))
        .limit(1)
    )
    
    if similar and cosine_similarity(similar.embedding, embedding) > 0.85:
        # 合并到已有实体
        similar.access_count += 1
        return similar.id
    else:
        # 创建新实体
        new_entity = GraphEntity(
            workspace_id=workspace_id,
            name=entity_name,
            embedding=embedding
        )
        db.add(new_entity)
        return new_entity.id
```

### 模块二：GNN 训练（Memory Reader Training）

借鉴 SAGE 的 `SAGERetriever`（prompt-aware GCN/GAT）。

#### 训练触发条件

满足以下任一条件触发训练：
1. 距离上次训练已过 7 天
2. 自上次训练后新增卡片数 ≥ 100 张

#### 训练模式

```python
from enum import Enum

class TrainingMode(Enum):
    LOCAL_CPU = "local_cpu"      # 本地 CPU 训练
    LOCAL_GPU = "local_gpu"      # 本地 GPU 训练（需 CUDA）
    REMOTE_GPU = "remote_gpu"    # 云端 GPU 训练

# 配置文件 server/.env
GNN_TRAINING_MODE=local_gpu
GNN_TRAINING_TRIGGER_CARDS=100
GNN_TRAINING_TRIGGER_DAYS=7
```

#### 训练流程

1. **导出图数据**：从 PostgreSQL 导出为 PyTorch Geometric `Data` 对象
   ```python
   edge_index = torch.tensor([[head_ids], [tail_ids]], dtype=torch.long)
   edge_type = torch.tensor(relation_type_ids, dtype=torch.long)
   rel_emb = torch.tensor(relation_embeddings, dtype=torch.float)
   
   graph_data = Data(
       edge_index=edge_index,
       edge_type=edge_type,
       rel_emb=rel_emb,
       num_nodes=num_entities,
       num_relations=num_relation_types
   )
   ```

2. **训练 GNN**：使用 SAGE 的 SAGERetriever 架构
   ```python
   model = SAGERetriever(
       num_nodes=graph_data.num_nodes,
       num_relations=graph_data.num_relations,
       hidden_dim=256,
       num_layers=3
   )
   
   optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
   
   for epoch in range(num_epochs):
       # 训练循环
       loss = train_step(model, graph_data, optimizer)
   ```

3. **保存 checkpoint**：
   ```python
   checkpoint_path = f"checkpoints/{workspace_id}_{timestamp}.pt"
   torch.save({
       'model_state_dict': model.state_dict(),
       'num_nodes': graph_data.num_nodes,
       'num_relations': graph_data.num_relations,
       'entity_id_map': entity_id_map,
       'relation_id_map': relation_id_map
   }, checkpoint_path)
   ```

#### 训练器抽象

```python
class GNNTrainer(ABC):
    @abstractmethod
    async def train(self, workspace_id: UUID, graph_data: Data) -> str:
        """训练 GNN，返回 checkpoint 路径"""
        pass

class LocalCPUTrainer(GNNTrainer):
    async def train(self, workspace_id: UUID, graph_data: Data) -> str:
        device = torch.device("cpu")
        model = SAGERetriever(...).to(device)
        # 训练循环
        return checkpoint_path

class LocalGPUTrainer(GNNTrainer):
    async def train(self, workspace_id: UUID, graph_data: Data) -> str:
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA not available")
        device = torch.device("cuda")
        model = SAGERetriever(...).to(device)
        # 训练循环
        return checkpoint_path

class RemoteGPUTrainer(GNNTrainer):
    async def train(self, workspace_id: UUID, graph_data: Data) -> str:
        # 序列化图数据
        payload = serialize_graph(graph_data)
        # 调用云函数
        response = await cloud_client.invoke("gnn-train", payload)
        # 下载 checkpoint
        return download_checkpoint(response.checkpoint_url)
```

### 模块三：GNN 检索（Memory Reader Retrieval）

借鉴 SAGE 的 `MemoryReaderRetriever`。

#### 检索流程

1. **实体识别**：从用户问题中抽取实体（复用 NER prompt）
2. **实体匹配**：在 `graph_entities` 中用 embedding 找到起始节点
3. **GNN 传播**：
   ```python
   # 加载训练好的模型
   model = load_checkpoint(checkpoint_path)
   
   # 构建查询输入
   query_embedding = embed_query(question)
   seed_entity_mask = create_entity_mask(matched_entities, num_nodes)
   
   # GNN 前向传播
   entity_scores = model(
       graph_data.edge_index,
       graph_data.edge_type,
       query_embedding,
       seed_entity_mask
   )
   ```
4. **回溯卡片**：通过 `entity_cards` 映射到源卡片
   ```python
   # 按实体分数聚合卡片分数
   card_scores = {}
   for entity_id, score in top_entities:
       cards = await get_cards_by_entity(entity_id)
       for card in cards:
           card_scores[card.id] = card_scores.get(card.id, 0) + score
   
   # 排序返回 top-k
   top_cards = sorted(card_scores.items(), key=lambda x: x[1], reverse=True)[:k]
   ```

#### Embedding 回退机制

对于新实体（不在 GNN 训练数据中）：
```python
if entity_id not in trained_entity_ids:
    # 回退到 embedding 相似度检索
    similar_cards = await embedding_search(query_embedding, k=10)
    return similar_cards
```

#### 推理路径返回

不只返回卡片列表，还返回推理路径：
```json
{
  "query": "RAG 的检索流程怎么优化",
  "reasoning_paths": [
    {
      "path": ["RAG", "使用", "余弦相似度", "可用于", "chunk 检索"],
      "score": 0.92
    },
    {
      "path": ["RAG", "包含", "向量数据库", "举例", "Milvus"],
      "score": 0.85
    }
  ],
  "cards": [
    {
      "id": "card_001",
      "title": "RAG 系统设计笔记",
      "matched_path": "RAG → 向量数据库",
      "score": 0.92
    },
    {
      "id": "card_002",
      "title": "Milvus 部署实践",
      "matched_path": "RAG → 向量数据库 → Milvus",
      "score": 0.85
    }
  ]
}
```

### 模块四：自进化闭环（混合方案）

借鉴 SAGE 的 deducibility evaluation，但用 **Few-shot 示例 + 用户反馈 + 示例池更新** 替代 SFT 训练。

> **设计说明**：SAGE 原版使用 SFT（监督微调）训练写入器，但这对 MindCard 来说过重（需要标注数据、训练基础设施、定期重训）。我们采用更轻量的混合方案：通过 few-shot 示例引导 LLM，通过用户反馈收集高质量样本，通过示例池自动更新实现持续改进。

#### 阶段 1：Few-shot 示例驱动的抽取

在 NER/RE prompt 中加入高质量三元组示例：

**改进后的 RE Prompt**：
```
抽取实体之间的关系三元组。

【高质量示例】
文本：RAG 使用 BGE-M3 做 embedding，存入 pgvector 向量数据库。
三元组：
- ["RAG", "使用", "BGE-M3"]
- ["BGE-M3", "功能", "embedding"]
- ["RAG", "使用", "pgvector"]
- ["pgvector", "类型", "向量数据库"]

【低质量示例（避免）】
❌ ["RAG", "相关", "embedding"]  # 关系太泛
❌ ["第一步", "是", "转向量"]  # 实体太细碎
❌ ["它", "使用", "数据库"]  # 实体不明确

现在抽取以下文本的三元组：

实体列表：
{entities}

原文：
{card_content}

输出格式：
[
  ["head", "relation", "tail"],
  ...
]
```

**示例池初始化**：
- 手工标注 20-30 个高质量三元组作为初始示例池
- 覆盖常见领域（RAG、向量数据库、LLM、embedding 等）

#### 阶段 2：用户反馈收集

**前端交互**：
- 卡片详情页显示抽取的三元组
- 用户可以标记每个三元组：👍 好 / 👎 差 / ✏️ 修正
- 修正时可以编辑 head/relation/tail

**后端存储**：
```sql
CREATE TABLE triple_feedback (
    id UUID PRIMARY KEY,
    triple_id UUID REFERENCES graph_relations(id),
    user_id UUID REFERENCES users(id),
    feedback_type TEXT NOT NULL,  -- 'good', 'bad', 'corrected'
    corrected_head TEXT,
    corrected_relation TEXT,
    corrected_tail TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

#### 阶段 3：示例池自动更新

定期（每月）运行更新流程：

1. **收集高质量样本**：
   ```python
   # 获取用户标记为"好"的三元组
   good_triples = await db.execute(
       select(GraphRelation, Card.content)
       .join(triple_feedback)
       .where(triple_feedback.feedback_type == 'good')
       .order_by(triple_feedback.created_at.desc())
       .limit(100)
   )
   ```

2. **分析低质量模式**：
   ```python
   # LLM 分析用户标记为"差"的三元组
   bad_triples = await get_bad_triples()
   
   analysis_prompt = f"""
   分析以下被用户标记为低质量的三元组，总结常见问题模式：
   
   {bad_triples}
   
   输出格式：
   1. 问题模式 1：[描述]
   2. 问题模式 2：[描述]
   ...
   """
   
   patterns = await llm.complete(analysis_prompt)
   ```

3. **更新示例池**：
   ```python
   # 从高质量样本中选择多样性最高的 10 个加入示例池
   diverse_examples = select_diverse_examples(good_triples, k=10)
   
   # 更新 prompt 模板
   await update_prompt_template(
       good_examples=diverse_examples,
       bad_patterns=patterns
   )
   ```

#### 阶段 4：质量评估（可选）

定期评估三元组的推理能力：

**评估 Prompt**：
```
给定以下知识子图和用户问题，判断这些三元组能否推导出正确答案。

子图：
- RAG 使用 BGE-M3
- BGE-M3 功能 embedding
- RAG 使用 余弦相似度
- 余弦相似度 用于 chunk 检索

用户问题：RAG 的检索流程是什么？

判断：这些三元组能否推导出答案？（是/否）
如果否，缺少哪些关键三元组？
```

评估结果用于：
- 识别知识图谱的薄弱环节
- 提示用户补充相关卡片
- 调整抽取策略（如某些关系类型被系统性遗漏）

### 模块五：反馈机制

#### 用户交互反馈

- 用户点击检索结果中的卡片 → 该卡片涉及的关系路径 weight +0.1
- 用户忽略检索结果（展示但未点击）→ weight -0.05
- 用户手动标记"不相关" → weight -0.2

```python
async def update_relation_weights(card_id: UUID, feedback: str):
    # 找到该卡片涉及的所有关系
    relations = await get_relations_by_card(card_id)
    
    weight_delta = {
        "click": 0.1,
        "ignore": -0.05,
        "irrelevant": -0.2
    }[feedback]
    
    for relation in relations:
        relation.weight += weight_delta
        relation.weight = max(0.1, min(2.0, relation.weight))  # 限制在 [0.1, 2.0]
```

#### GNN 训练时的权重利用

高权重关系作为正样本增强：
```python
# 训练时对高权重边进行采样增强
edge_weights = torch.tensor([r.weight for r in relations])
sampling_prob = edge_weights / edge_weights.sum()
sampled_edges = torch.multinomial(sampling_prob, num_samples, replacement=True)
```

### 模块六：拓扑树与图记忆关联

#### 核心实体标记

对话创建卡片后，自动标记核心实体：

```python
async def mark_core_entities(tree_node_id: UUID):
    # 获取该节点下所有卡片
    cards = await get_cards_by_tree_node(tree_node_id)
    
    # 统计实体频次
    entity_freq = Counter()
    for card in cards:
        entities = await get_entities_by_card(card.id)
        entity_freq.update([e.id for e in entities])
    
    # Top-3 作为核心实体
    core_entity_ids = [eid for eid, _ in entity_freq.most_common(3)]
    
    # 更新拓扑节点
    await db.execute(
        update(TreeNode)
        .where(TreeNode.id == tree_node_id)
        .values(core_entity_ids=core_entity_ids)
    )
```

#### 前端展示

- 拓扑树 3D 视图中，节点显示核心实体标签
- 点击标签跳转到图记忆 2D 视图，高亮该实体及其邻居

## 技术栈

### 后端新增依赖

```toml
# pyproject.toml
[tool.poetry.dependencies]
torch = "^2.0.0"
torch-geometric = "^2.3.0"
networkx = "^3.1"
```

### 前端新增依赖

```json
// web/package.json
{
  "dependencies": {
    "d3-force": "^3.0.0",
    "d3-hierarchy": "^3.1.2"
  }
}
```

## 实现路径

### 阶段 1：三元组抽取（1-2 周）

**目标**：卡片创建时自动抽取三元组并存储

**任务**：
1. 创建数据库表（`graph_entities`, `graph_relations`, `entity_cards`）
2. 实现两步 LLM 流水线（NER → RE）
3. 实现实体链接（embedding 去重）
4. 集成到卡片创建流程（`cards.py` 的 `_generate_embedding` 后台任务）
5. 编写单元测试

**验收标准**：
- 创建卡片后，`graph_entities` 和 `graph_relations` 表有数据
- 同义实体被正确合并

### 阶段 2：图存储与基础检索（1 周）

**目标**：实现简单图遍历检索（不用 GNN）

**任务**：
1. 实现递归 CTE 图遍历查询
2. 新增 API：`GET /api/graph/search?q={query}`
3. 返回推理路径 + 源卡片
4. 编写集成测试

**验收标准**：
- 用户提问能返回相关卡片和推理路径
- 验证多跳推理能力

### 阶段 3：GNN 训练流水线（2-3 周）

**目标**：实现三种训练模式

**任务**：
1. 集成 PyTorch Geometric
2. 实现图数据导出（PostgreSQL → PyG Data）
3. 实现 SAGERetriever 模型（参考 SAGE 源码）
4. 实现三种训练器（LocalCPU / LocalGPU / RemoteGPU）
5. 实现训练触发逻辑
6. 创建 `gnn_training_logs` 表记录训练历史
7. 编写训练脚本和测试

**验收标准**：
- 手动触发训练成功，生成 checkpoint
- 三种训练模式都能跑通

### 阶段 4：在线 GNN 检索（1 周）

**目标**：用训练好的 GNN 做检索

**任务**：
1. 实现 checkpoint 加载
2. 实现 GNN 检索 API
3. 实现 embedding 回退机制
4. 替换阶段 2 的简单遍历为 GNN 检索
5. 性能测试和优化

**验收标准**：
- GNN 检索比简单遍历更准确
- 新实体能正确回退到 embedding 检索

### 阶段 5：自进化闭环（1-2 周）

**目标**：实现 Few-shot 示例驱动和用户反馈收集

**任务**：
1. 创建 `triple_feedback` 表
2. 前端：卡片详情页显示三元组，支持 👍/👎/✏️ 反馈
3. 初始化示例池（手工标注 20-30 个高质量三元组）
4. 更新 NER/RE prompt，加入 few-shot 示例
5. 实现示例池自动更新脚本（LLM 分析 + 多样性选择）
6. 实现三元组质量评估（可选）

**验收标准**：
- 用户能对三元组进行反馈
- Few-shot 示例能改善抽取质量
- 示例池能自动更新

### 阶段 6：前端可视化（1-2 周）

**目标**：图记忆可视化和拓扑树关联

**任务**：
1. 新增页面 `/workspaces/[id]/knowledge-graph`
2. 实现 2D 力导向图可视化（D3.js）
3. 拓扑树节点显示核心实体标签
4. 实现跳转逻辑（拓扑树 ↔ 图记忆）
5. 检索结果展示推理路径

**验收标准**：
- 图记忆可视化清晰易懂
- 拓扑树和图记忆能互相跳转

**总计：8-12 周**

## 与 SAGE 的对应关系

| SAGE 组件 | MindCard 实现 | 差异 |
|-----------|--------------|------|
| Memory Writer（三元组抽取） | 两步 LLM 流水线（NER → RE） | 相同 |
| Graph Storage | PostgreSQL 替代 kg.txt + PyG | 用关系数据库替代文件 |
| Memory Reader（GNN 检索） | SAGERetriever，定期批量训练 | 增加训练触发条件和三种训练模式 |
| Self-Evolution | Few-shot 示例 + 用户反馈 + 示例池更新 | 更轻量实用，避免 SFT 训练的复杂度 |
| Feedback Loop | Weight 调整 + 用户反馈收集 | 更简单，基于用户交互 |

## 风险与挑战

### 技术风险

1. **GNN 训练成本**：大规模图训练耗时长，需要优化训练效率
2. **动态图适配**：新实体加入后 GNN 需要重训，存在检索质量延迟
3. **三元组质量**：LLM 抽取的三元组可能有噪音，需要持续优化

### 缓解措施

1. 提供三种训练模式，用户可根据硬件条件选择
2. Embedding 回退机制保证新实体的检索质量
3. 自进化闭环持续改进抽取质量

## 未来扩展

### 短期（3-6 个月）

- 支持多模态实体（图片、代码片段）
- 实体消歧（同名不同义的实体）
- 图记忆导出/导入（跨工作空间共享）

### 中期（6-12 个月）

- 增量图学习（无需重训整个 GNN）
- 跨用户协作图记忆
- 图记忆推荐（主动推荐相关知识）

### 长期（12+ 个月）

- 多模态图记忆（文本 + 图像 + 视频）
- 联邦学习（多用户图记忆联合训练）
- 图记忆可解释性（为什么推荐这些卡片）

## 参考文献

- SAGE: A Self-Evolving Agentic Graph-Memory Engine for Structure-Aware Associative Memory (arXiv:2605.12061)
- SAGE 源码：/home/ljb/program/demo/ref/Unified-Representation-A9D9
- DeepTutor: Towards Agentic Personalized Tutoring (arXiv:2604.26962)
