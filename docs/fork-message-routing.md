# Fork 消息路由：最深已展开 Fork 机制

决定用户输入框消息归属哪条对话的核心规则。

## 概念

**"最深已展开 Fork"**（Deepest Expanded Fork）：当用户在输入框发送消息时，系统遍历当前所有**已展开（未折叠）**的 fork，选择 **depth 最大**（最深层）的那一个作为消息的目标对话。如果没有展开的 fork，消息发到 root 对话。

```
root (depth=0)
 ├── fork A (depth=1) [折叠]
 ├── fork B (depth=1) [展开]      ← 候选 1
 │   ├── sub-fork C (depth=2) [展开]  ← 候选 2 ✓ 最深
 │   └── sub-fork D (depth=2) [折叠]
 └── fork E (depth=1) [折叠]

用户发送消息 → 路由到 sub-fork C（depth=2 最深）
```

## 设计动机

### 为什么需要明确规则？

MindCard 允许同时展开多个嵌套 fork（父+子）。当用户在输入框打字时，必须确定性地决定消息归属，否则会出现"消息进了 A 但 UI 显示在 B"的认知失调。

### 为什么是"最深"而非"最近展开"？

| 候选规则 | 问题 |
|---------|------|
| 最近展开 | 与折叠语义冲突（折叠会清空 activeForkId） |
| 最近点击 | LLM 自动 fork 时无点击事件 |
| 最深已展开 | ✓ 与视觉焦点一致、与折叠语义自洽、自动 fork 也能工作 |

**最深 = 最具体的上下文**：深层 fork 包含更精确的讨论范围，符合"在当前讨论里继续追问"的直觉。

## 核心实现

### 三套并行状态

`web/components/AiChatPanel.tsx` 维护三个状态，必须保持同步：

| 状态 | 类型 | 用途 |
|------|------|------|
| `expandedForks` | `Set<string>` | 决定哪些 fork 在 UI 上展开 + 消息路由 |
| `activeForkId` | `string \| null` | 面包屑路径显示 + 视觉焦点 |
| `activeChatIdRef.current` | ref | 避免闭包过期（stale closure） |

### 核心函数

```typescript
// AiChatPanel.tsx:1025-1036
const getDeepestExpandedFork = useCallback((): string | null => {
  let deepest: string | null = null;
  let maxDepth = -1;
  for (const forkId of expandedForksRef.current) {
    const depth = forkMetaRef.current[forkId]?.depth ?? 0;
    if (depth > maxDepth) {
      maxDepth = depth;
      deepest = forkId;
    }
  }
  return deepest;
}, []);
```

### 消息发送流程

```typescript
// AiChatPanel.tsx:1043-1075
const doSend = async (question: string) => {
  const activeChildChatId = getDeepestExpandedFork();
  streamingForkIdRef.current = activeChildChatId;  // 标记流属于哪个 fork

  // ...构造 history（过滤掉非当前 fork 的 sibling 消息）...

  const saveTarget = activeChildChatId || currentChatId;
  saveMessage(saveTarget, "user", question);  // 持久化到目标 chat
};
```

## 折叠/展开语义

`handleForkNavigate(forkId)` 是状态同步的核心。它保证 `expandedForks` 中 depth 最大的就是 `activeForkId`。

### 展开 fork X

```
1. 折叠所有 depth >= X.depth 的非 X fork（sibling + 更深后代）
2. 展开 X
3. 展开所有 depth < X.depth 的 fork（祖先链）
4. activeForkId = X
```

**关键不变量**：展开后，`expandedForks` 中 depth 最大的就是 X。

### 折叠 fork X

```
1. 折叠 X + 所有 depth > X.depth 的 fork
2. 如果 activeForkId === X 或是 X 的后代，重置为 null
```

折叠后，用户回到 root 视图，输入消息进 root chat。

## 三类触发场景

| 场景 | 触发函数 | 同步状态 |
|------|---------|---------|
| 用户点击 fork header 折叠/展开 | `handleForkNavigate` | expandedForks + activeForkId + ref |
| LLM 自动 fork（create_fork 工具） | `fork_created` 事件 | expandedForks + activeForkId + ref |
| 面包屑导航 | `loadChatAndFocusFork` → `handleForkNavigate` | 同上 |

每条路径都必须**同步更新三个状态**，否则会出现"消息路由 ≠ 面包屑显示"的不一致。

## 边界情况

### 没有 expanded fork

`getDeepestExpandedFork()` 返回 `null` → `saveTarget = currentChatId`（root）。

### 多个 expanded fork（嵌套）

由于展开 X 时折叠了所有 sibling，`expandedForks` 实际上是一条**祖先链**（root → ... → X）。`getDeepestExpandedFork` 返回链尾的 X。

### Fork depth 未知（刚创建未刷新）

`forkMetaRef.current[forkId]?.depth ?? 0` —— 默认 depth=0。新 fork 创建时立即写入 depth（`forkMetaRef.current[childChatId] = { depth, ... }`），所以不会出现 depth 缺失。

### 切换 workspace / 加载新 chat

`activeChatIdRef.current = null`、`setActiveForkId(null)`、`syncExpandedForks(new Set())` —— 全部重置，回到 root 视图。

## 历史 Bug 与修复

### Bug 1: fork_created 不同步 activeForkId

**表现**：LLM 调用 `create_fork` 工具自动创建子对话后，消息正确路由到子对话（`getDeepestExpandedFork` 返回新 fork），但面包屑仍显示 root 路径（`activeForkId` 未更新）。

**根因**：`fork_created` 事件 handler 只调用了 `syncExpandedForks`，遗漏 `setActiveForkId`。

**修复**（commit `c20df1f`）：

```typescript
syncExpandedForks((prev) => new Set([...prev, childChatId]));
setActiveForkId(childChatId);              // 新增
activeChatIdRef.current = childChatId;     // 新增
```

### Bug 2: 触发 fork 的 user question 不持久化到子对话

**表现**：触发 fork 的 user question 在前端用 `childChatId` 字段做 UI 标记（视觉上属于子对话），但后端 `chat_id` 仍是父对话。刷新页面后，加载子对话会丢失这条 user question。

**根因**：前端 in-memory `childChatId` 字段不是后端归属，没有同步 `chatApi.addMessage(childId, "user", question)`。

**修复**（commit `3267d81`）：在 `fork_created` handler 中，捕获 triggering question 并调用 `chatApi.addMessage` 持久化到子对话。

## 维护指南

修改任何与 fork 状态相关的代码时，确认以下三点：

1. **任何修改 `expandedForks` 的代码路径**，必须同步 `activeForkId` + `activeChatIdRef.current`
2. **新增 fork 创建路径**（如新的工具、API），必须保证 `forkMetaRef.current[childId].depth` 立即可用
3. **新增折叠/展开入口**（如键盘快捷键、外部按钮），必须复用 `handleForkNavigate` 而非直接操作 `expandedForks`

违反任意一条都会导致"消息路由 ≠ 面包屑显示"的不一致。

## 相关代码

| 文件:行 | 作用 |
|---------|------|
| `web/components/AiChatPanel.tsx:1025-1036` | `getDeepestExpandedFork` |
| `web/components/AiChatPanel.tsx:1038-1076` | `doSend` + `saveMessage` |
| `web/components/AiChatPanel.tsx:228-264` | `handleForkNavigate` 折叠/展开语义 |
| `web/components/AiChatPanel.tsx:563-635` | `fork_created` 事件处理 |
| `web/components/AiChatPanel.tsx:794-813` | chatPath useEffect（面包屑路径） |
| `web/components/AiChatPanel.tsx:894-919` | `loadChatAndFocusFork`（面包屑点击） |
| `web/components/ForkBreadcrumb.tsx` | 面包屑渲染 |

## 相关文档

- [Conversation Fork](./conversation-fork.md) — Fork 的整体设计、四种 profile、压缩策略
- [RAG Pipeline](./rag-pipeline.md) — 跨分支洞察注入与记忆检索
