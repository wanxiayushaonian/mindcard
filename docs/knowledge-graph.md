# Knowledge Graph

MindCard 的知识图谱系统从卡片内容中自动提取实体和关系，构建可遍历的知识网络。

## 架构总览

```
卡片内容
  ↓
TripleExtractor（LLM 三元组提取）
  ↓
EntityLinker（实体消歧与链接）
  ↓
GraphEntity + GraphRelation + EntityCard（持久化）
  ↓
CommunityDetector（Leiden 社区检测）
  ↓
CommunityReport（LLM 社区摘要）
```

## 三元组提取

`TripleExtractor` 使用单次 LLM 调用，输出自定义 tuple 格式（非 JSON）：

```
(entity<|>名称<|>类型<|>描述)
(relationship<|>源实体<|>目标实体<|>描述<|>强度)
```

- 分隔符：`<|>` 分字段，`##` 分记录
- 文本截断：3000 字符
- 温度：0.2（确定性优先）

**Gleaning 循环**：首次提取少于 15 个实体时，自动执行第二轮提取，提示 LLM 查找遗漏项。如果无遗漏，输出 `<|COMPLETE|>`。

**查询时提取**：`extract_entities_only` 方法执行轻量 NER（无关系提取，max 64 tokens），用于检索时从用户问题中提取实体。

## 实体消歧

`EntityLinker` 通过三级策略将新提取的实体与已有图谱关联：

| 级别 | 条件 | 操作 |
|------|------|------|
| 精确匹配 | 名称完全一致（不区分大小写） | 直接合并 |
| 高置信度 | 余弦相似度 ≥ 0.85 | 自动合并 |
| 模糊区间 | 0.70 ≤ 相似度 < 0.85 | LLM 共指消解（max 4 tokens） |

- 嵌入计算：优先使用 `"name: description"` 组合文本
- 合并时：递增 `access_count`，回填缺失描述
- 阈值：`LINK_SIMILARITY_THRESHOLD = 0.85`，`LINK_CANDIDATE_THRESHOLD = 0.70`

## 图遍历检索

`GraphRetriever.retrieve` 的检索流程：

1. **实体提取**：从查询中提取实体
2. **实体匹配**：精确匹配（ILIKE）→ 嵌入余弦搜索（阈值 0.7）
3. **卡片评分**：0-hop / 1-hop / 2-hop 三级评分
4. **推理路径**：为每个匹配实体探索 top-3 关系，构建推理链

评分衰减：
```
0-hop: entity_match_score
1-hop: relation_weight × 0.3
2-hop: base × relation_weight × 0.5（阈值 0.02）
```

如果无实体匹配，回退到纯 embedding 余弦搜索。

## 社区检测

`CommunityDetector` 使用 Leiden 算法（python-igraph + leidenalg）：

1. 构建无向图（实体为节点，关系为边，权重 1.0）
2. `ModularityVertexPartition` 分区（resolution=1.0，seed=42）
3. 丢弃单例社区（size < 2）
4. 删除旧社区后插入新社区

**社区报告**：每个社区生成 LLM 报告（并发限制 2），输入最多 30 个实体描述 + 30 个关系描述，输出：
- 标题
- 摘要
- 最多 3 个发现
- 影响评分（1-10）

报告会被嵌入以便语义搜索。

## 图谱清理

`GraphCleaner.cleanup_workspace` 执行两项操作：

- **孤立实体删除**：没有关系且没有 `EntityCard` 关联的实体
- **过期关系删除**：`head_id` 或 `tail_id` 指向已删除实体的关系

**HNSW 索引**：在 `graph_entities.embedding` 上创建 pgvector HNSW 索引（m=16, ef_construction=64）加速近似搜索。

## 数据模型

| 模型 | 表 | 关键字段 |
|------|-----|---------|
| `GraphEntity` | `graph_entities` | name, entity_type, description, embedding, access_count |
| `GraphRelation` | `graph_relations` | head_id, tail_id, relation, weight, source_card_id |
| `EntityCard` | `entity_cards` | entity_id, card_id（复合主键） |
| `Community` | `communities` | title, level, entity_ids[], relationship_ids[], size |
| `CommunityReport` | `community_reports` | title, summary, findings[], rating, embedding |

所有嵌入列使用 `Vector(settings.embedding_dim)`，所有工作区范围的表通过 FK CASCADE 关联。

## 前端展示

- **D3.js 力导向图**：可视化实体-关系网络
- **时间轴模式**：全部 / 按时间 / 按事件三种视图
- **回放动画**：展示知识积累过程
- **推理路径**：在 AI 回答下方内联展示图遍历路径

## 相关文件

| 文件 | 职责 |
|------|------|
| `server/app/services/triple_extractor.py` | LLM 三元组提取 |
| `server/app/services/entity_linker.py` | 实体消歧与链接 |
| `server/app/services/gnn_retriever.py` | 图遍历检索 |
| `server/app/services/community.py` | Leiden 社区检测 + 报告生成 |
| `server/app/services/graph_cleanup.py` | 孤立实体/过期关系清理 |
| `server/app/models/graph.py` | 数据模型定义 |
| `server/app/api/graph.py` | 图谱 API 端点 |
