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

## 相关文件

| 文件 | 职责 |
|------|------|
| `server/app/tools/create_fork.py` | LLM 分叉工具 |
| `server/app/tools/fork_profiles.py` | 分叉模式定义 |
| `server/app/services/fork_compress.py` | 上下文压缩 |
| `server/app/api/ws.py` | WebSocket 分叉处理 |
| `web/components/AiChatPanel.tsx` | 前端分叉 UI |
| `web/components/ForkDivider.tsx` | 分叉导航条 |
| `web/components/ForkBreadcrumb.tsx` | 分叉面包屑 |
