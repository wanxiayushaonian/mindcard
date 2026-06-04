# Stello 分叉引擎采用 — 设计规格

> **自动化工作代理提示：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 来逐步实现此计划。步骤使用 checkbox (`- [ ]`) 语法进行跟踪。

**目标：** 用 Stello 的 `@stello-ai/core` 引擎替换 MindCard 临时的分叉系统，提供真正的隔离对话分支和跨会话上下文共享。

**架构：** 一个 Node.js sidecar 服务封装 `@stello-ai/core`，对外暴露 HTTP API 进行会话管理。MindCard 的 Python FastAPI 将新对话操作代理到此 sidecar。旧对话保持不变（仅向前迁移）。

**技术栈：** `@stello-ai/core`、Node.js + Fastify、PostgreSQL（共享实例，独立表）、Next.js 前端

---

## 问题陈述

MindCard 当前的分叉功能存在三个关键问题：

1. **假分叉** — 内联分叉分隔符（`role="fork-divider"`）只是单个对话内的视觉分隔符，并不创建隔离的对话分支。实际的 `POST /fork` API 会创建子 `AiChat` 行，但 UI 将两种模型混为一谈。

2. **两个模型共存** — 内联分隔符（在单个对话内）和子对话（带 `parent_chat_id` 的独立 `AiChat` 行）令人困惑地共存。两种模型都不完整。

3. **缺乏用户控制** — 通过话题漂移检测（余弦相似度 < 0.7）的自动分叉静默发生，无法审查、调整阈值或撤销。

## 解决方案：采用 Stello 引擎

采用 `@stello-ai/core` 作为对话拓扑引擎。Stello 提供：

- **隔离会话** — 每个分支是一个独立的 Session，拥有自己的消息历史
- **三槽上下文模型** — `systemPrompt`（持久化，每次调用注入）、`insight`（一次性收件箱）、`memory`（给其他会话的外部描述）
- **分叉压缩** — 分叉时，父上下文被压缩并注入子会话的 `systemPrompt`
- **跨分支通信** — 通过 `SharedMemoryStore` 和 `refs`（非父子节点间的拓扑链接）
- **拓扑树** — `TopologyNode` 对象的森林，包含 `parentId`、`children`、`refs`、`depth`、`index`、`label`

## 架构

```
┌─────────────────────────────────────────────────────┐
│                   浏览器 (Next.js)                    │
│                                                      │
│  AiChatPanel                                         │
│    ├── 旧对话 → 现有 chatApi（不变）                   │
│    └── 新对话 → stelloApi（新增）                      │
│              │                                       │
│         HTTP/WebSocket                               │
│              │                                       │
│              ▼                                       │
│       Python FastAPI                                 │
│         ├── 认证、RAG、卡片、网页搜索（不变）             │
│         ├── 旧对话端点（不变）                          │
│         └── 新会话代理 → Node.js Stello 服务           │
│                                      │               │
│                                 @stello-ai/core      │
│                                      │               │
│                                 PostgreSQL           │
│                              (stello_* 表)           │
└─────────────────────────────────────────────────────┘
```

### 性能影响

Sidecar **不在** LLM 流式传输路径中：

| 操作 | 路径 | 延迟影响 |
|------|------|---------|
| LLM 流式传输 | 浏览器 → Python → LLM → 流式返回 | 无（不变） |
| RAG 检索 | Python → embedding + 搜索 | 无（不变） |
| 创建会话 | Python → Node.js sidecar → 数据库 | +10-50ms（一次性） |
| 分叉会话 | Python → Node.js sidecar → 数据库 | +10-50ms（一次性） |
| 加载历史 | Python → Node.js sidecar → 数据库 | +10-50ms（一次性） |

所有实时流式传输保持在 Python 中。Sidecar 仅处理会话状态管理。

## 数据模型

### Stello 表（新增，在共享 PostgreSQL 中）

```sql
-- 会话元数据 + 拓扑
CREATE TABLE stello_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES stello_sessions(id),
    label TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'archived'
    turn_count INTEGER NOT NULL DEFAULT 0,
    depth INTEGER NOT NULL DEFAULT 0,
    index_in_siblings INTEGER NOT NULL DEFAULT 0,
    source_session_id UUID,  -- 分叉上下文来源
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 会话消息
CREATE TABLE stello_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES stello_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,  -- 'user' | 'assistant' | 'system'
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 跨分支引用
CREATE TABLE stello_refs (
    from_id UUID NOT NULL REFERENCES stello_sessions(id) ON DELETE CASCADE,
    to_id UUID NOT NULL REFERENCES stello_sessions(id) ON DELETE CASCADE,
    PRIMARY KEY (from_id, to_id)
);

-- 共享记忆（跨会话上下文）
CREATE TABLE stello_shared_memory (
    session_id UUID NOT NULL REFERENCES stello_sessions(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    body TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, slug)
);

CREATE INDEX idx_stello_sessions_parent ON stello_sessions(parent_id);
CREATE INDEX idx_stello_sessions_workspace ON stello_sessions(workspace_id);
CREATE INDEX idx_stello_messages_session ON stello_messages(session_id);
```

### 与 Stello 概念的映射

| Stello 概念 | MindCard 实现 |
|------------|--------------|
| `SessionMeta.id` | `stello_sessions.id`（UUID） |
| `TopologyNode.parentId` | `stello_sessions.parent_id` |
| `TopologyNode.children` | 从 `parent_id` 查询派生 |
| `TopologyNode.refs` | `stello_refs` 表 |
| `SessionTree.getTree()` | `stello_sessions` 上的递归 CTE |
| `SharedMemoryStore` | `stello_shared_memory` 表 |
| `FileSystemAdapter` | `PgAdapter`（新增，实现 Stello 的存储接口） |
| 会话文件（memory.md、scope.md、index.md） | `stello_shared_memory` 行 |

### MindCard ↔ Stello 会话关联

每个 MindCard `AiChat`（旧模型）保持不变。新对话同时创建 Stello 会话和一个轻量级 `AiChat` 行以保持向后兼容：

```
AiChat.id = UUID
AiChat.stello_session_id = UUID（可为空，新对话设置）
AiChat.workspace_id = UUID
AiChat.title = TEXT
AiChat.mode = 'stello'（新模式值）
```

`stello_session_id` 链接到 Stello 的会话。旧对话的 `stello_session_id = NULL`。

## Node.js Sidecar 服务

### 包结构

```
server/stello-service/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Fastify HTTP 服务器
│   ├── routes/
│   │   ├── session.ts        # CRUD、分叉、消息
│   │   └── topology.ts       # 树查询
│   ├── adapters/
│   │   └── pg-adapter.ts     # Stello 存储的 PostgreSQL 实现
│   ├── bridge.ts             # 映射 MindCard RAG 上下文 → systemPrompt
│   └── types.ts              # 共享类型
└── dist/
```

### 核心 API 端点

```
POST   /api/sessions
  请求体: { workspace_id, parent_id?, label?, source_session_id? }
  返回: { id, topology_node }

GET    /api/sessions/:id
  返回: { session_meta, topology_node, config }

POST   /api/sessions/:id/messages
  请求体: { role, content, metadata? }
  返回: { message }
  副作用: 更新 turn_count、last_active_at

POST   /api/sessions/:id/fork
  请求体: { label?, context_strategy?: 'none'|'inherit'|'compress' }
  返回: { child_session, topology_node }

GET    /api/sessions/:id/messages
  返回: { messages[] }

GET    /api/sessions/:id/tree
  返回: { tree: SessionTreeNode }

GET    /api/sessions/:id/ancestors
  返回: { ancestors: TopologyNode[] }

POST   /api/sessions/:id/memory
  请求体: { slug, body }
  返回: { entry }

GET    /api/sessions/:id/memory
  返回: { entries: SharedMemoryEntry[] }

DELETE /api/sessions/:id
  返回: { ok: true }

GET    /api/workspaces/:wid/sessions
  返回: { roots: SessionTreeNode[] }
```

### PgAdapter

使用 PostgreSQL 而非文件系统实现 Stello 的存储接口：

- `createSession()` → INSERT 到 `stello_sessions`
- `get(id)` → SELECT 从 `stello_sessions`
- `listAll()` → 带 workspace 过滤的 SELECT
- `getTree()` → 递归 CTE
- `getAncestors(id)` → 沿 parent_id 链遍历
- `getSiblings(id)` → 相同 parent_id
- 消息 → `stello_messages` 表
- 记忆 → `stello_shared_memory` 表
- 引用 → `stello_refs` 表

### Stello 会话的 WebSocket 流式传输

现有的 WebSocket 处理器（`server/app/api/ws.py`）继续处理 LLM 流式传输。对于 Stello 会话：

1. 客户端发送 `rag` 事件，使用 `stello_session_id` 代替 `chat_id`
2. Python 处理器从 sidecar 加载会话上下文：`GET /api/stello/sessions/{id}` + `GET /api/stello/sessions/{id}/messages`
3. 从以下内容构建 `systemPrompt`：RAG 上下文 + workspace 提示词 + Stello 会话的现有 system prompt
4. 从 Stello 消息发送历史（而非 `ChatMessage` 表）
5. 通过相同的 WebSocket 流式传输 LLM 响应
6. 流式传输完成时：保存助手消息到 sidecar：`POST /api/stello/sessions/{id}/messages`
7. 自动分叉检测：Python 在检测到漂移时调用 sidecar 的分叉端点，向客户端发送 `auto_fork` 事件

WebSocket 协议（事件类型：`content`、`sources`、`done`、`error`、`auto_fork`）保持不变。仅数据源发生变化。

### 分叉压缩集成

当分叉被触发（手动或自动）时：

1. 通过 `SessionTree.createSession({ parentId, sourceSessionId })` 创建子会话
2. 应用分叉压缩策略：
   - `'compress'`：读取消息，调用 LLM 生成摘要，附加到子会话的 `systemPrompt`
   - `'inherit'`：原样复制父会话的 `systemPrompt`
   - `'none'`：不传递上下文
3. 更新父会话的 `memory.md`，添加分支摘要
4. 将子会话 ID 返回给 MindCard

MindCard 的 Python 后端使用所选策略调用 sidecar。默认值：自动分叉使用 `'compress'`，手动分叉使用 `'inherit'`。

## 前端变更

### 新增 API 客户端

`web/lib/stello-api.ts` — Stello 会话端点的薄客户端，通过 MindCard 的 FastAPI 代理：

```ts
export const stelloApi = {
  createSession: (workspaceId: string, parentId?: string) =>
    request('/api/stello/sessions', { method: 'POST', body: { workspace_id: workspaceId, parent_id: parentId } }),
  getSession: (sessionId: string) =>
    request(`/api/stello/sessions/${sessionId}`),
  sendMessage: (sessionId: string, role: string, content: string) =>
    request(`/api/stello/sessions/${sessionId}/messages`, { method: 'POST', body: { role, content } }),
  fork: (sessionId: string, label?: string) =>
    request(`/api/stello/sessions/${sessionId}/fork`, { method: 'POST', body: { label } }),
  getMessages: (sessionId: string) =>
    request(`/api/stello/sessions/${sessionId}/messages`),
  getTree: (sessionId: string) =>
    request(`/api/stello/sessions/${sessionId}/tree`),
  getAncestors: (sessionId: string) =>
    request(`/api/stello/sessions/${sessionId}/ancestors`),
  listWorkspaceSessions: (workspaceId: string) =>
    request(`/api/stello/workspaces/${workspaceId}/sessions`),
};
```

### AiChatPanel 变更

**会话模式检测：**
```ts
const isStelloSession = chatId && chat?.mode === 'stello';
```

- 旧对话（`mode !== 'stello'`）：通过现有逻辑渲染，内联分叉分隔符、面包屑导航
- 新对话（`mode === 'stello'`）：使用 `stelloApi`，渲染分支树

**分支树 UI（内联水平树，替代面包屑导航）：**

```
── "探索RAG原理" ──┬── "向量检索细节"（当前，高亮）
                  └── "图谱增强方案"
```

- 每个节点显示截断的会话标签
- 当前分支用主色高亮
- 点击切换分支（加载该会话的消息）
- 任意节点上的 "+" 按钮可从该点分叉
- 悬停显示完整标签 + 消息数
- 超出宽度时水平滚动

**分叉触发：**
- 移除"分叉模式"切换按钮
- 替换为：输入特殊前缀（如 `// `）后按回车，或点击树节点上的 "+"
- 手动分叉创建子会话并立即加载
- 自动分叉：服务端通过 Stello 引擎检测，发送 `auto_fork` WebSocket 事件

**跨分支洞察指示器：**
- 分支树上显示来自兄弟分支的洞察数量小徽章
- 点击展开下拉列表显示洞察内容
- 用户可将洞察"注入"当前会话的上下文

### 仅向前迁移

- 旧对话：`chatApi.get()`、`chatApi.list()` — 渲染不变
- 新对话：`stelloApi.getSession()`、`stelloApi.getMessages()` — 新渲染逻辑
- 历史面板：旧对话按 `parent_chat_id` 分组，新会话按 Stello 树分组
- 视觉区分：新会话显示小树形图标徽章

## 配置

### 环境变量（server/.env）

```env
# Stello sidecar
STELLO_SERVICE_URL=http://localhost:3001
STELLO_ENABLED=true

# 分叉行为
STELLO_AUTO_FORK=true
STELLO_FORK_CONTEXT_STRATEGY=compress  # none | inherit | compress
STELLO_DRIFT_THRESHOLD=0.7
```

### 设置 UI

在设置页面添加"对话分叉"部分：
- 自动分叉开关（开/关）
- 上下文策略选择器（none/inherit/compress）
- 漂移阈值滑块（0.5-0.9）

## 实现阶段

### 阶段 1：Sidecar 基础设施
- 初始化 `server/stello-service/`，使用 TypeScript + Fastify
- 安装 `@stello-ai/core`
- 实现 `PgAdapter`，适配 Stello 的存储接口
- 创建 `stello_*` 表的 PostgreSQL 迁移
- 实现会话 CRUD + 消息端点
- Docker compose：添加 stello-service 容器
- 健康检查端点
- PgAdapter 单元测试

### 阶段 2：后端集成
- 在 `AiChat` 模型中添加 `stello_session_id` 列（可为空）
- 对话创建支持 `mode='stello'`
- Python 代理路由：`/api/stello/*` → sidecar
- WebSocket 处理器：新会话通过 Stello 路由
- RAG 上下文注入 Stello 的 `systemPrompt`
- 分叉压缩与 MindCard LLM 服务集成
- 自动分叉检测委托给 Stello 引擎
- 旧对话端点不变

### 阶段 3：前端
- 创建 `web/lib/stello-api.ts`
- 更新 AiChatPanel：检测会话模式，相应分支
- 实现内联水平树 UI
- 分支切换逻辑
- 分叉触发（替代分叉模式切换）
- 跨分支洞察指示器
- 保留旧对话渲染
- 分叉配置设置 UI

## 测试策略

- **单元测试：** PgAdapter CRUD、分叉压缩、树查询
- **集成测试：** Sidecar HTTP API、Python 代理路由
- **端到端测试：** 创建会话 → 发送消息 → 分叉 → 切换分支 → 验证隔离
- **回归测试：** 旧对话渲染不变，旧对话的内联分叉分隔符仍正常工作

## 部署

```yaml
# docker-compose.yml 新增
services:
  stello-service:
    build: ./server/stello-service
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://mindcard:mindcard@postgres:5432/mindcard
    depends_on:
      - postgres
```

单个 `docker compose up` 启动所有服务。Sidecar 与 MindCard 共享 PostgreSQL 但使用自己的表。
