# Topic & Topology

MindCard 有两套知识组织系统：**Topic**（自动聚类）和 **Topology**（对话树层级）。它们独立运行，通过卡片关联。

## Topic — 自动主题聚类

### 工作原理

`TopicService` 使用贪心余弦距离聚类：

1. 新卡片到来时，通过 pgvector `cosine_distance` 找到最近的 Topic
2. 如果距离低于**自适应阈值**，卡片归入该 Topic；否则创建新 Topic
3. 归入后重新计算 Topic 质心（L2 归一化的成员嵌入均值）

### 自适应阈值

阈值从卡片嵌入的两两余弦距离动态计算：

```
阈值 = median(两两距离) × 0.7，限制在 [0.2, 0.6]
```

- 少于 5 张卡片时使用默认值 0.45
- 阈值越低，聚类越严格（更容易创建新 Topic）

### Topic 命名

自动从成员卡片的 top-3 高频关键词生成，用 " / " 连接。

### 重建

`rebuild_topics` 方法删除所有 Topic 后重新聚类，使用增量质心更新。通过 PostgreSQL advisory lock 防止并发冲突。

## Topology — 对话树层级

### 工作原理

`TopologyService` 将卡片分配到对话树节点（`AiChat` 节点，通过 `parent_id` 形成层级结构）。

- 使用固定阈值 `0.55`
- 如果指定了 `default_node_id` 且相似度 > 0.7，直接归入该节点
- 否则搜索所有非根、非归档节点
- 无匹配时回退到根节点（自动创建为"主线"）

### 自动绑定

`auto_bind_chat_to_node` 在新对话创建时，根据首条消息自动绑定到拓扑节点（阈值 0.7）。

### 节点增强

- **核心实体标记**：`mark_core_entities` 标记 top-3 高频实体
- **节点摘要**：`update_node_summary_from_chat` 从最近消息生成 LLM 摘要（50-100 字符）

## Topic Synthesis — 主题综合

将 Topic 或 Topology 节点下的卡片综合为结构化笔记。

### 四种综合模式

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| `timeline` | 按时间/逻辑顺序 | 事件发展、学习路径 |
| `argument` | 论点-证据结构 | 研究论证、观点整理 |
| `comparison` | 维度对比 | 方案比较、差异分析 |
| `free` | 自动检测最佳结构 | 通用场景 |

### 子树收集

使用递归 CTE（`collect_subtree_card_ids` / `collect_subtree_node_ids`）收集节点及其所有后代的卡片。

### 模板系统

支持保存和复用综合模板，可配置综合模式、输出格式、关注维度等。

## 数据模型

### Topic

| 字段 | 类型 | 说明 |
|------|------|------|
| `workspace_id` | UUID | 工作区 |
| `name` | String | 主题名称（自动生成） |
| `centroid` | Vector | 质心嵌入 |
| `card_count` | Integer | 成员卡片数 |

关联：`topic_cards`（N:M join table）

### Topology Node

复用 `AiChat` 模型，通过 `parent_id` 形成树结构，`node_type="branch"` 标识拓扑节点。

## 两套系统的关系

| 维度 | Topic | Topology |
|------|-------|----------|
| **生成方式** | 自动（embedding 聚类） | 自动 + 手动（对话树） |
| **更新频率** | 每张新卡片触发 | 新对话/分叉触发 |
| **卡片归属** | 一个卡片属于一个 Topic | 一个卡片可关联多个节点 |
| **结构** | 扁平聚类 | 树形层级 |
| **用途** | 发现知识主题 | 组织对话脉络 |

两个系统目前**完全独立**，通过 `topic_cards` 和 `NodeCard` 各自关联卡片。

## 相关文件

| 文件 | 职责 |
|------|------|
| `server/app/services/topic.py` | Topic 聚类服务 |
| `server/app/services/topology.py` | 拓扑树服务 |
| `server/app/services/synthesis.py` | 主题综合服务 |
| `server/app/models/topic.py` | Topic 数据模型 |
| `server/app/api/topics.py` | Topic API |
| `server/app/api/topology.py` | Topology API |
| `server/app/schemas/synthesis.py` | 综合 schema |
