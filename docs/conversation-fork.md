# Conversation Fork

对话分叉（Fork）是 MindCard 的核心创新之一 — 将线性对话变成树状探索。

## 设计理念

传统 AI 对话是线性的：用户 → AI → 用户 → AI。但人的思维是树状的：

```
问题 A
├─ 分支 1：深入探讨某个细节
├─ 分叉 2：发散探索相关领域
├─ 分叉 3：总结已有讨论
└─ 分叉 4：质疑挑战结论
```

Fork 让用户可以在任意对话节点分叉出新分支，每个分支有独立的对话上下文和探索方向。

## 分叉流程

```
用户/AI 触发分叉
  ↓
create_fork 工具（LLM 可调用）
  ↓
SplitGuard 速率检查
  ↓
ForkCompressor 压缩父对话上下文
  ↓
创建子 AiChat（depth = parent.depth + 1）
  ↓
在父对话插入 fork-divider 消息
  ↓
返回子对话 ID + system_prompt_suffix
```

### SplitGuard

防止过度分叉的速率限制器。当短时间内分叉次数过多时阻止分叉，除非设置 `force=true`。

### 上下文压缩

`ForkCompressor` 提供三种策略：

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| `none` | 不传递父对话上下文 | 完全新方向 |
| `inherit` | 原样传递对话文本 | 需要完整上下文（如总结） |
| `compress` | LLM 结构化摘要（max 500 tokens） | 大多数分叉场景 |

压缩输出格式：主题、关键发现、开放问题、重要上下文。

## 四种分叉模式

| 模式 | 标签 | 上下文策略 | 目的 |
|------|------|-----------|------|
| `deep_dive` | 深入探讨 | compress | 聚焦核心细节、底层原理、代码示例 |
| `explore` | 发散探索 | compress | 跨域关联、头脑风暴、启发式提问 |
| `summarize` | 总结提炼 | inherit | 结构化回顾、关键结论、行动项 |
| `challenge` | 质疑挑战 | compress | 魔鬼辩护、风险评估、替代方案 |

## fork-divider

父对话中的标记消息，记录分叉点：
- 子对话 ID
- 分支标签
- 上下文摘要
- 深度
- 分叉模式

前端渲染为可点击的分叉导航条。

## 对话树结构

```
Root Chat (depth=0)
├─ message 1
├─ message 2
├─ fork-divider → Branch A (depth=1)
│   ├─ message A1
│   ├─ fork-divider → Branch A1 (depth=2)
│   │   └─ message A1-1
│   └─ message A2
├─ message 3
├─ fork-divider → Branch B (depth=1)
│   └─ message B1
└─ message 4
```

- 每个分支有独立的消息历史
- 分支可以继续分叉（depth 递增）
- fork-divider 在父对话中标记分叉点
- 前端支持折叠/展开分支

## 拓扑集成

分叉创建的子对话会自动绑定到拓扑树节点，形成知识组织结构：
- 子对话的 `node_type = "branch"`
- 拓扑路径注入 RAG 上下文（L3 CONTEXT 级别）
- 交叉引用（related/contradicts/extends）连接不同分支

## 跨分支链接（NodeRef）

Fork 创建的树状结构只能表达父子关系。**NodeRef** 提供图状的语义边，让任意两个分支建立关系。

### 三种引用类型

| 类型 | 语义 | 颜色 | 用途 |
|------|------|------|------|
| `related` | 相关 | 蓝色 | 两个分支讨论相关主题 |
| `contradicts` | 矛盾 | 红色 | 一个分支的结论与另一个冲突 |
| `extends` | 扩展 | 紫色 | 一个分支扩展了另一个的讨论 |

### 数据模型

`NodeRef` 表（`server/app/models/topology.py:24-36`）：
- `source_chat_id` + `target_chat_id`：直接引用 `ai_chats` 表（不是 topology node）
- `ref_type`：related / contradicts / extends
- `reason`：可选，用户填写的关系说明

**有方向**：A→B 与 B→A 是不同的关系。`extends` 特别具有方向性（A extends B 意味着 A 是 B 的扩展）。

### API

```http
POST /api/topology/{node_id}/refs
  body: { target_chat_id, ref_type, reason }
  → 建立从 node_id 到 target_chat_id 的引用

DELETE /api/topology/{node_id}/refs/{target_id}
  → 删除指定引用
```

### 双向引用显示

`TreeNodeResponse` 同时返回两个方向的引用，让用户看到完整图状关系：

| 字段 | 含义 | 前端显示 |
|------|------|---------|
| `ref_details` | 我引用了谁（outgoing） | LinkBranchDialog 顶部"已链接"列表 |
| `incoming_ref_details` | 谁引用了我（incoming） | LinkBranchDialog "被引用"列表 |

incoming 用 amber dashed border 视觉区分 outgoing（gray solid）。

### UI 入口

Link2 图标按钮位于面包屑旁，打开 `LinkBranchDialog`：
- 顶部"已链接"列表（含 type badge + reason + 删除按钮）
- "被引用"列表（只读，显示谁引用了当前分支）
- 创建表单（目标选择 + 三色 ref_type + reason）
- 删除二次确认 / ESC 关闭 / 创建高亮（2s emerald 闪烁）

## 合并分支（Merge）

Merge 操作将两个分支交给 LLM 综合为一个新对话，是 problem.md "图状思维网络" 提议的最后一块拼图。

### 触发条件

- 同一 workspace
- 不能与自己合并
- 两边都有消息
- 用户权限 editor+

**不要求同级**：任意 depth 的两个分支都能合并。**source 是主、target 是辅**：合并产物挂在 source 子树下，target 保持原位通过 NodeRef 关联。

### 合并流程

```
源对话 A                       目标对话 B
   │                              │
   │  POST /api/topology/merge    │
   │  ↓                           │
   │  LLM 综合两边的最近 30 条消息 │
   │  ↓                           │
   │  ┌──────────────────────┐    │
   │  │ 新对话 C             │    │
   │  │  ├ parent_id = A     │←───┘ NodeRef(B→C, extends)
   │  │  ├ 首条 assistant    │
   │  │  │  = 综合结果       │
   │  │  └ NodeRef(A→C)      │
   │  └──────────────────────┘    │
   │                              │
   └─ fork-divider 标记合并点     │
```

### LLM 综合模板

输出结构化 Markdown：
- `## 分支A核心论点`（3 条）
- `## 分支B核心论点`（3 条）
- `## 共识` / `## 分歧` / `## 互补`
- `## 综合视角`（整合两边）

总长 ≤ 800 字，温度 0.4。

### 层级规则

```
C.depth = source.depth + 1
C.parent_id = source.id
```

**完全基于 source**——target 的 depth 不影响 C 的位置。如果 source 和 target 不是同级，C 会挂在 source 子树下，可能造成"产物比目标还深"的情况（祖先-后代合并）。

### UI 入口

GitMerge 图标按钮位于 Link2 旁，打开 `MergeBranchDialog`：
- amber warning 提示"将创建新对话"
- 红色警告（如果检测到祖先-后代关系）
- **挂载点 toggle**：用户可选 source 或 target 作为父
- depth 预览：实时显示"新分支将挂在 X 下，depth=N"
- 成功后自动 `loadChatAndFocusFork(newChatId)` 跳转

### 失败处理

LLM 综合失败返回 500 + 错误原因。前端 toast 显示，不破坏现有数据（事务回滚）。

## 相关文件

| 文件 | 职责 |
|------|------|
| `server/app/tools/create_fork.py` | LLM 分叉工具 |
| `server/app/tools/fork_profiles.py` | 分叉模式定义 |
| `server/app/services/fork_compress.py` | 上下文压缩 |
| `server/app/services/claim_extractor.py` | Fork claims 抽取 |
| `server/app/api/chat.py` | Fork API endpoint |
| `server/app/api/topology.py` | NodeRef + Merge API |
| `server/app/api/ws.py` | WebSocket 分叉处理 |
| `server/app/schemas/topology.py` | NodeRef / Merge schemas |
| `web/components/AiChatPanel.tsx` | 前端分叉 UI + link/merge 入口 |
| `web/components/ForkBreadcrumb.tsx` | 分叉面包屑 |
| `web/components/LinkBranchDialog.tsx` | 跨分支链接管理 |
| `web/components/MergeBranchDialog.tsx` | 分支合并对话框 |

## 相关文档

- [Fork Message Routing](./fork-message-routing.md) — 最深已展开 fork 路由规则
- [Workspace Memory](./workspace-memory.md) — Fork claims 作为 memory_type='claim' 存储
- [RAG Pipeline](./rag-pipeline.md) — 跨分支洞察注入
