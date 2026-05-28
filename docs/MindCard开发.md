
当前阶段认知：当前的mindcard开发的基本框架已经完成。

# 问题1
当前卡片的来源大多数是对于在日常与ai对话中输出内容的摘抄，对于零摩擦的摘抄存的的问题就是碎片化的，每一个卡片中存在的知识点都是孤立的信息节点，这样做可以方便检索与管理，但却使得内容丧失了结构，失去了主线。

# 反思
我要做的mindcard是应该有一条线性主线的，在加上分支，构成一个庞大的多叉树结构（后续或许考虑可视化）。而这条主线由什么串起来？我想到了一个idea,我在与ai对话中常常会因为在一个持续增长的对话框中一步一步的进行，一方面我们人类会因为"认知负载"在ai输出的上下文中"不知所措"，另一方面，ai的能力也并不是无限的，因为当前的ai上下文有限，我们在一步一步的问答中，对话也就积累的越来越多，这时ai需要压缩上下文——对于一些无关紧要的内容进行精简等等，这里不多阐述。这虽然给了模型一个感觉的上下文，但是有时也会因为压缩过当丢失细节导致模型变笨。

而我真正想实现的是通过一个多叉树模型，外加信息卡片的数据存储。构成一个有时间、有结构知识拓扑图。
聊一聊这个拓扑图的结构，这是整体拓扑结构的基石，我想他应该由一个agent系统来维护。
这个agent系统包括：
1. 对话agent：这个智能体是一个基础人口级agent，他主要承担着人类与模型交流时产出的内容拓扑结构，简单来说，我们在与ai进行交流时，会产生很多数据，对于有用的数据，我们会做一个操作"沉淀"，将知识沉淀为卡片存入向量库，这个里面还有一个重要内容是"分叉"——即对于话题层级或类别的跳跃，我们会因为对于ai抛出的一个问题而感兴趣，从而说"我想进一步了解......"然而人脑存在认知负载，看完分支内容在想回到主线就可能有点困难了。另一方面过多的数据也会造成ai上下窗口的注意力分散即：长对话中，AI可能完全忽略开头或中间的关键指令，导致回答偏离主题。当用户插入大量背景信息或连续提问时，AI的"注意力"会分散到最新内容上。复杂推理任务中，AI需要同时持有多个前提，上下文长度不足时推理会出错。用户重复提及相同内容会浪费上下文空间，降低有效利用率。回到对话agent的功能说明，对话agent的作用就是锚定跳跃点，对于深入讨论等问题应该分配一个子agent给用户，进行深层次的讨论。同时子agent也要反馈信息给主agent，用于主agent的上下文。
值得注意的是由于外部的浏览器、以及外接qqbot都可能产生卡片，并入聚类。可能产生跳跃。
2. 知识库agent：见下方补全内容。

---

# 补全：Agent 系统设计

## 2. 知识库 Agent

知识库 Agent 是整个系统的"记忆中枢"。它的职责不是参与对话，而是**维护知识的组织结构**。

### 核心职责

```
知识库 Agent
├─ 卡片沉淀：对话 Agent 产出的卡片，经过知识库 Agent 归类
├─ 话题聚类：基于 embedding 相似度，将卡片聚合为话题
├─ 拓扑维护：管理多叉树的节点关系（父子、兄弟、跨分支引用）
├─ 综合文档：将同一话题下的零散卡片，综合为结构化文档
└─ 冲突检测：发现不同分支中对同一问题的不同结论
```

### 与对话 Agent 的协作关系

```
用户
 │
 ▼
对话 Agent（主线）
 │
 ├── 用户说"沉淀" → 发送卡片给知识库 Agent
 │                    知识库 Agent：归类 + 聚类 + 挂载到拓扑树
 │                    返回：该卡片所属话题 + 已有卡片数量
 │
 ├── 用户说"我想深入了解 X" → 对话 Agent 分叉
 │    │
 │    ▼
 │   子对话 Agent（分支）
 │    │
 │    ├── 子对话结束 → 生成摘要 → 反馈给主对话 Agent
 │    │                          知识库 Agent：将分支产出的卡片
 │    │                                       挂载到拓扑树对应节点
 │    │
 │    └── 子对话中又分叉 → 递归创建子子 Agent
 │
 └── 用户说"综合此话题" → 对话 Agent 通知知识库 Agent
                           知识库 Agent：检索该话题下所有卡片
                                        调用 LLM 综合为结构化文档
                                        保存为 TopicDocument
```

### 外部来源处理

```
浏览器插件 / QQ Bot / 微信 Bot 产出卡片
    │
    ▼
知识库 Agent
    │
    ├── 1. 生成 embedding
    ├── 2. 与现有话题做 cosine 相似度匹配
    ├── 3. 如果相似度 > 阈值（0.75）→ 归入已有话题
    │       → 通知用户："这张卡片归入了话题 [RAG 架构]"
    ├── 4. 如果相似度 < 阈值 → 创建新话题
    │       → 通知用户："发现了新话题 [xxx]，是否确认？"
    └── 5. 检测是否为跨分支桥梁
            → 如果这张卡片同时关联两个不同分支的话题
            → 在拓扑图中创建跨分支引用
```

---

## 3. 拓扑树结构设计

### 树的定义

```
拓扑树 = 有根多叉树 + 跨分支引用

节点类型：
  root     — 根节点（每个工作区一个，代表"我的知识体系"）
  branch   — 分支节点（由对话中的分叉产生，代表一个思考方向）
  leaf     — 叶子节点（沉淀的卡片，或综合文档）

边的类型：
  parent   — 父子关系（分叉产生）
  ref      — 跨分支引用（知识库 Agent 自动检测或用户手动创建）
```

### 树的生长方式

```
初始状态：
  root
   └─ 主线对话

用户沉淀卡片 A：
  root
   └─ 主线对话
       └─ [卡片 A]

用户说"我想深入了解 RAG"：
  root
   └─ 主线对话
       ├─ [卡片 A]
       └─ 🌿 RAG 探索（子 Agent 启动）
           └─ [卡片 B] [卡片 C]

用户回到主线，继续对话，沉淀卡片 D：
  root
   └─ 主线对话
       ├─ [卡片 A]
       ├─ 🌿 RAG 探索（已完成，摘要已反馈）
       │   ├─ [卡片 B]
       │   └─ [卡片 C]
       └─ [卡片 D]

知识库 Agent 检测到卡片 B 和卡片 D 有关联：
  root
   └─ 主线对话
       ├─ [卡片 A]
       ├─ 🌿 RAG 探索
       │   ├─ [卡片 B] ──ref──→ [卡片 D]
       │   └─ [卡片 C]
       └─ [卡片 D]
```

### 节点的数据结构

```json
{
  "id": "node-uuid",
  "type": "branch",
  "title": "RAG 架构探索",
  "description": "用户在讨论 DeepSeek 集成时，对 RAG 检索策略产生了兴趣，分叉深入探索",
  "parent_id": "parent-node-uuid",
  "agent_session_id": "session-uuid",
  "card_ids": ["card-1", "card-2"],
  "child_ids": ["child-node-1", "child-node-2"],
  "refs": ["node-in-another-branch"],
  "summary": "探索了三种 RAG 检索策略，最终选定 RRF 混合搜索",
  "status": "active | completed | archived",
  "created_at": "2026-05-28T10:00:00Z",
  "completed_at": null
}
```

---

## 4. 对话 Agent 详细设计

### 上下文管理策略

```
当前问题：长对话中 AI 上下文爆炸，压缩过当丢失细节

解决思路：用树结构替代线性对话

主 Agent 上下文构成：
┌─────────────────────────────────────────┐
│ System Prompt（固定，~500 tokens）       │
├─────────────────────────────────────────┤
│ 拓扑树摘要（动态，~300 tokens）          │
│  "当前路径：主线 > RAG 架构 > 向量检索"  │
│  "已完成分支：RAG 探索（结论：...）"     │
├─────────────────────────────────────────┤
│ 当前分支最近 N 轮对话（滚动窗口）        │
├─────────────────────────────────────────┤
│ 相关卡片内容（RAG 检索，按需加载）        │
└─────────────────────────────────────────┘

子 Agent 上下文构成：
┌─────────────────────────────────────────┐
│ System Prompt（继承主 Agent + 分支任务）  │
├─────────────────────────────────────────┤
│ 分支触发上下文                           │
│  "用户在讨论 X 时，想深入了解 Y"         │
│  相关卡片内容                            │
├─────────────────────────────────────────┤
│ 子对话滚动窗口                           │
└─────────────────────────────────────────┘
```

### 分叉触发条件

**用户显式触发**（推荐，确定性高）：
- 自然语言："我想深入了解一下..."、"等等，先说说..."、"这个展开讲讲"
- UI 操作：点击卡片右键 → "探索此方向"、对话中点击 🌿 按钮

**不建议自动触发**：
- Agent 自动判断分叉容易误判
- 用户会失去对树结构的控制感
- "我刚才说的那句话到底算不算分叉？"——不必要的认知负担

### 子 Agent 生命周期

```
创建：
  用户触发分叉 → 主 Agent 创建子 Agent
  → 子 Agent 继承当前话题上下文（摘要级别，非全量）
  → 子 Agent 有明确的探索问题作为任务边界

运行：
  子 Agent 与用户对话
  → 产出的卡片自动关联到当前分支节点
  → 子 Agent 也可以再分叉（递归）

结束：
  用户说"明白了" / "回到主线" / 长时间无交互（>30min 自动暂停）
  → 子 Agent 生成分支摘要（~100-200 字）
  → 摘要反馈给主 Agent，注入主上下文
  → 分支状态标记为 "completed"
  → 用户回到主 Agent 继续主线对话

摘要格式：
  "分支 [RAG 架构探索] 已完成。
   结论：选择 RRF 混合搜索，权重 0.7:0.3。
   产出卡片 3 张。详细内容已归档。"
```

---

## 5. 数据模型补充

在现有数据模型基础上，需要新增的表：

### 知识拓扑树节点

```sql
CREATE TABLE tree_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ONDELETE CASCADE,
    parent_id UUID REFERENCES tree_nodes(id) ONDELETE CASCADE,
    node_type VARCHAR(20) NOT NULL DEFAULT 'branch',  -- 'root' | 'branch' | 'leaf'
    title VARCHAR(256) NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    summary TEXT DEFAULT '',                -- 分支完成后的摘要
    status VARCHAR(20) DEFAULT 'active',    -- 'active' | 'completed' | 'archived'
    agent_session_id UUID,                  -- 关联的对话 session
    sort_order INT DEFAULT 0,              -- 兄弟节点排序
    metadata JSONB DEFAULT '{}',           -- 扩展字段
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_tree_nodes_workspace ON tree_nodes(workspace_id);
CREATE INDEX idx_tree_nodes_parent ON tree_nodes(parent_id);
CREATE INDEX idx_tree_nodes_status ON tree_nodes(status);
```

### 树节点与卡片的关联

```sql
CREATE TABLE node_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID NOT NULL REFERENCES tree_nodes(id) ONDELETE CASCADE,
    card_id UUID NOT NULL REFERENCES cards(id) ONDELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(node_id, card_id)
);

CREATE INDEX idx_node_cards_node ON node_cards(node_id);
CREATE INDEX idx_node_cards_card ON node_cards(card_id);
```

### 跨分支引用

```sql
CREATE TABLE node_refs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_node_id UUID NOT NULL REFERENCES tree_nodes(id) ONDELETE CASCADE,
    target_node_id UUID NOT NULL REFERENCES tree_nodes(id) ONDELETE CASCADE,
    ref_type VARCHAR(20) DEFAULT 'related',  -- 'related' | 'contradicts' | 'extends'
    reason TEXT DEFAULT '',                    -- 引用原因（知识库 Agent 填写）
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(source_node_id, target_node_id)
);
```

### 话题综合文档

```sql
CREATE TABLE topic_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID NOT NULL REFERENCES tree_nodes(id) ONDELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ONDELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ONDELETE CASCADE,
    title VARCHAR(256) NOT NULL DEFAULT '',
    content TEXT DEFAULT '',
    source_card_ids UUID[] DEFAULT '{}',
    synthesis_options JSONB DEFAULT '{}',
    version INT DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(node_id, author_id)
);
```

---

## 6. 可视化设计

### 主视图：知识拓扑图

```
基于现有的 D3 ForceGraph 扩展：

节点样式：
  root    — 大圆，中心位置，固定不动
  branch  — 中圆，按层级分布，可拖拽
  leaf    — 小圆（卡片），挂在所属分支下

边样式：
  parent 关系 — 实线，从上到下（树形布局）
  ref 关系   — 虚线，弧形跨分支

交互：
  点击分支节点 → 展开/折叠子树
  右键卡片    → "综合此话题" / "探索此方向"
  拖拽节点    → 调整布局（不改变数据关系）
  时间轴滑块  → 按时间过滤，观察树的生长过程
```

### 面包屑导航

```
默认状态下（不展开拓扑图），用面包屑表示当前位置：

  📍 主线 > RAG 架构探索 > 向量检索精度
                               ↑ 当前分支

  点击任意层级 → 跳转到该分支的对话
  点击 📍      → 展开完整拓扑图
```

---

## 7. 实现路径

```
Phase 0（当前可做）：
  ✅ 卡片存储 + 向量检索 + 话题聚类
  ✅ 浏览器插件 / API Key
  → 验证：碎片化是否真的是问题，观察实际使用中用户是否需要结构化

Phase 1：拓扑树数据模型
  → 迁移：tree_nodes, node_cards, node_refs 表
  → API：创建/查询/移动节点，关联卡片
  → 前端：面包屑导航（最简 MVP）

Phase 2：对话 Agent 分叉机制
  → 子 Agent 创建 + 生命周期管理
  → 分支摘要生成 + 反馈主 Agent
  → 前端：分叉按钮 + 子对话面板

Phase 3：知识库 Agent 自动归类
  → 卡片沉淀时自动挂载到拓扑树节点
  → 跨分支引用自动检测
  → 外部来源卡片并入聚类

Phase 4：综合文档
  → 话题综合编辑器（Typora 风格）
  → AI 综合 + 手动编辑
  → 版本管理

Phase 5：拓扑图可视化
  → D3 ForceGraph 扩展为树形布局
  → 时间轴 + 生长动画
  → 跨分支引用虚线
```

---

## 8. 核心设计原则

1. **用户控制优先于 Agent 自动**：分叉由用户触发，不自动判断。树结构应该是用户能直觉理解的，而不是 Agent 的黑盒决策。

2. **摘要优于全量**：子 Agent 反馈主 Agent 用摘要，不用全量上下文。这是解决上下文爆炸的关键。

3. **结构服务于思考，而非反之**：拓扑图是思考的副产品，不是思考的目的。用户不需要"维护树"，树自动从对话中生长出来。

4. **扁平存储 + 树形展示**：卡片本身还是扁平存储在向量库中（方便检索），树结构是叠加在卡片之上的组织层（方便导航）。两层独立，互不污染。

5. **外部来源无差别并入**：浏览器插件、QQ Bot、微信 Bot 产出的卡片，通过聚类自动归入拓扑树。来源不同，但最终都在同一棵知识树中找到位置。
