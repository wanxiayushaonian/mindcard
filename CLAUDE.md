# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **产品理念与方向见 [`VISION.md`](VISION.md)** —— 这是 MindCard 的产品宪法（为什么做、什么是对的）。
> 开发新功能前先对照 VISION，确认它服务"发散→沉淀→收敛→复现"的认知循环。

## Project Overview

MindCard — a knowledge card management platform with WeChat mini-program, Python backend, and Next.js web frontend. Core loop: **cards (Markdown) → BGE-M3 embeddings → topic clusters / topology tree / knowledge graph → AI chat with multi-level RAG**. Includes conversation forking (branching memory), workspace memories with decay, graph community reports (GraphRAG-style), multi-provider LLM support, Redis rate limiting, and per-user LLM cost quotas.

> ⚠️ 架构文档以本文件为准。`docs/` 下的论文（branching memory、GraphRAG、memory decay 等）已在 `server/app/services/` 落地实现，改动前先读对应 service。

## Architecture

```
mindcard-workspace/
├── server/          # FastAPI backend (async SQLAlchemy + PostgreSQL + pgvector + Redis)
├── web/             # Next.js 14 App Router frontend (Tailwind + SWR + WebSocket)
├── miniapp/         # WeChat mini-program (Skyline renderer)
└── extensions/      # Chrome/Firefox browser extension (Web Clipper)
```

部署架构见 `deploy/README.md`（Caddy 单域：`mindcard.online` 路径转发 `/api/*`、`/ws` → 后端；生产 `NEXT_PUBLIC_API_URL` 必须为同域）。

### Server (`server/app/`)

- **api/** — FastAPI 路由按域拆分：`auth`(JWT)、`workspaces`(+`memories`/`synthesis-templates`)、`cards`(+`comments`)、`search`、`rag`、`chat`(+`fork`/`path`/`summarize`/`insights`)、`ai`(纯文本工具)、`topics`、`topology`、`graph`(实体/关系/社区/清理/HNSW)、`notifications`、`activities`、`settings`(管理员/provider/`embedding-meta`)、`settings/api-keys`、`external`(Web Clipper)、`ws`(实时聊天 WebSocket)
- **models/** — ORM 模型：Card / CardChunk / CardRelation / CardProcessingJob、User / Workspace、AiChat / ChatMessage、Topic / TopicCard、NodeCard / NodeRef、GraphEntity / GraphRelation / EntityCard / CommunityReport、WorkspaceMemory / BranchInsight / SynthesisTemplate、Activity / Notification / ApiKey、LLMUsageDaily
- **schemas/** — Pydantic 请求/响应模型（含 `retrieval.py` 的 `RetrievalLevel` 枚举与 `RetrievalResult`）
- **services/** — 业务逻辑，见下方分组
- **providers/** — LLM Provider 抽象，**Factory + Registry 模式**：
  - `registry.py` — `ProviderSpec` frozen dataclass；`PROVIDERS` 字典映射 provider 名 → spec
  - `factory.py` — `make_provider()` 解析名字 → 具体 `LLMProvider`
  - `base.py` — `LLMProvider` 抽象基类
  - `openai_compat.py` — OpenAI 兼容 provider（DeepSeek/OpenAI/Gemini/Moonshot/custom）
  - `anthropic.py` — Anthropic 专用 provider
- **tools/** — **LLM 工具调用系统**（base/registry/`_builtin`）：注册于启动时；聊天中模型可调用 `create_fork`、`memory_edit`、`fork_profiles` 等工具
- **utils/** — `auth.py`(JWT + 角色 + 上下文用户)、`card_tasks.py`(后台任务队列)、`usage.py`(ContextVar 用量归属 + 配额)、`rate_limit.py`(滑动窗口限流)、`cursor.py`(游标分页)、`activity.py`、`wechat.py`

前端：`lib/api.ts` 负责所有 HTTP（JWT 存 localStorage）；`lib/unified-ws.ts` 是**实时聊天 WebSocket 客户端**（自动重连 + 心跳 + 事件分派）；`lib/store.ts` 为 Zustand 状态。

### Key Patterns

- 所有 LLM 调用经 Provider Registry —— 业务代码只调 `make_provider()` + `LLMProvider` 接口，不感知具体厂商
- 所有 provider 用原生 `httpx`（无 SDK 依赖），429/5xx 指数退避重试
- 搜索用 RRF（Reciprocal Rank Fusion）融合 BGE-M3 向量检索 + PostgreSQL 全文检索
- **聊天流式走 WebSocket**（`/api/ws`，事件：`content`/`sources`/`web_search_results`/`auto_fork`/`fork_created`/`content_replace`/`tool_executing`/`tool_executed`/`thinking`/`context_debug`/`done`/`error`/`cancelled`）；REST 的 `/api/rag/*/stream` 仍是 SSE（`streamRequest`）
- 数据获取：REST 用 SWR，聊天流式用 WS，SSE 用手动 fetch
- 认证：JWT 存 localStorage，`Authorization: Bearer` 头携带；WS 用 `?token=` 查询参数 + 成员校验
- **成本控制**：每次聊天/提取的 token 用量经 ContextVar 归属用户 → 写 `llm_usage_daily` → 每日配额 `llm_daily_quota_tokens` 用 `llm_quota_guard` 依赖在 API 层拦截

### Retrieval Levels（5 级渐进式）

`RetrievalDispatcher`（`services/retrieval_dispatcher.py`）把查询路由到 5 个深度等级，每级都有降级回退：

| Level | 枚举 | 机制 |
|-------|------|------|
| CHAT | `CHAT` (0) | 纯 LLM + 历史，不检索 |
| SEARCH | `SEARCH` (1) | 混合检索（向量 + 全文 RRF） |
| EXPLORE | `EXPLORE` (2) | 图遍历：实体匹配 → 1/2 跳打分 → 卡片重排（无结果回退 SEARCH） |
| CONTEXT | `CONTEXT` (3) | 图检索 + 拓扑路径上下文（祖先链/积累卡片/跨分支引用注入 prompt） |
| INSIGHT | `INSIGHT` (4) | 社区报告 Map-Reduce（GraphRAG 风格；无报告回退 SEARCH） |

`detect_level()` 自动检测：短问句→SEARCH；"总览/全局/梳理/分析"等关键词→INSIGHT/CONTEXT；实体向量匹配→EXPLORE；**保守默认 SEARCH**（避免 NER 开销）。

### Background Task Chain（持久化队列）

卡片创建触发 `enqueue_card_task()`（`utils/card_tasks.py`），流程：

1. 先写 `card_processing_jobs` 表（幂等：已有 pending/running 任务不重复入队）
2. 按 workspace 入内存队列 → 单 worker 串行处理（每 workspace 一把锁），全局 `asyncio.Semaphore(2)` 限并发
3. 管道：**embedding（卡 + 分块 `CardChunk`）→ 主题分配 → 拓扑分类 → 三元组抽取 + 实体链接**
4. `MAX_ATTEMPTS=3`；失败标记 `failed`+`last_error`；**启动时 `recover_pending_jobs()` 重排队**（重启即重试退避）
5. 临时卡（`is_temp`）跳过管道；三元组失败不阻断主流程（WARN + 继续）

另有一个 fire-and-forget 的 **fork 声明抽取**（`enqueue_claim_extraction_task`）：fork 后把父会话蒸馏成 3-7 条知识 claim，存为 `WorkspaceMemory(memory_type='claim')`，每 workspace 信号量限并发 1。

### Conversation Forking（分支记忆）

- 聊天可 fork 出子分支；`AiChat.parent_id` 构成树，`NodeCard` 绑定分支与卡片
- `split_guard.py` 阻止过度 fork（本分支消息数 / 兄弟分支同名标签 / 全局冷却）
- `fork_compress.py` 压缩父会话上下文注入子分支（策略由 `fork_context_strategy` 控制：`none`/`inherit`/`compress`）
- fork 后后台抽取 claim（见上）→ 子分支经 `WorkspaceMemory` 注入继承父会话知识

### Memory System（工作区记忆 + 衰减）

- `WorkspaceMemory`（`memory_type`：`fact` 默认 / `claim` fork 产物 / `archived` 归档），带 embedding 参与 RAG 注入
- `consolidation.py`：**每 5 条用户消息**触发一次单次合并 LLM 调用 → 更新会话摘要 `AiChat.summary` + 生成跨分支 `BranchInsight` + 更新 `WorkspaceMemory`
- `memory_decay.py` 两级遗忘：读取时 `base_importance * exp(-days_unused / HALF_LIFE_DAYS)` 计算衰减；低于阈值且过期的记忆物理标记 `archived`，退出 RAG 注入

### Knowledge Graph（知识图谱）

- `triple_extractor.py`：LLM 抽取实体/三元组（GraphRAG `<|>` 元组格式）
- `entity_linker.py`：实体链接、消歧、实体↔卡片绑定（`EntityCard`）
- `community.py`：Leiden 聚类 → 分层社区报告 `CommunityReport`（供 INSIGHT 级 map-reduce 使用）
- `gnn_retriever.py`：图检索（纯 Python hop 遍历打分，无 torch）
- `graph_cleanup.py`：清理孤立实体/过期关系，可选合并重复实体
- `/api/graph/communities/detect` 手动触发社区检测；`/api/graph/hnsw-index` 建索引

### Token Budget（上下文预算）

`services/token_budget.py` 在 RAG 上下文组装时强制全局 token 预算：多源（卡片/图路径/记忆/分支洞察/拓扑/指令）按 `BudgetConfig` 比例分配；`query_instructions` 硬保留不可截断，`retrieved_cards` 为弹性桶。估算用字符数/3.5 启发式（零依赖，对中文保守）。

## Development Commands

### Backend (server/)

```bash
cd server
uv sync                                    # Install dependencies
uv run alembic upgrade head                # Run DB migrations
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000  # Dev server
docker compose up -d postgres redis        # Start DB + Redis
uv run ruff check .                        # Lint
uv run mypy app/                           # Type check
uv run pytest                              # Run tests
uv run python -m scripts.reembed           # 重嵌入（embedding_model 打标/换模型时用）
```

### Web Frontend (web/)

```bash
cd web
pnpm install        # Install dependencies
pnpm dev            # Dev server (port 3000)
pnpm build          # Production build
pnpm lint           # ESLint
```

### Mini-Program

Open `miniapp/` in WeChat DevTools. No build step — uses native WeChat framework.

### Browser Extension

Load `extensions/mindcard-clipper/` as unpacked extension in Chrome (`chrome://extensions/`, developer mode). Manifest V3.

## Database

- PostgreSQL 15+ with pgvector extension；Redis（限流后端，`rate_limit_backend=redis` 时必用）
- Alembic migrations in `server/alembic/`（40+ 版本；近关键：`k01_structured_memory`→`l01_card_processing_jobs`→`m01_add_embedding_model`→`n01_add_llm_usage`）
- 连接：`postgresql+asyncpg://mindcard:mindcard@localhost:5432/mindcard`
- **Embedding 版本管理**：7 张向量表均有 `embedding_model` 列（`provider/model` 标签）；启动时 `check_embedding_consistency()` 检测漂移并告警；改模型后跑 `scripts/reembed.py`

## Workspace Collaboration

Four-tier role system: `owner > admin > editor > viewer` (+ `pending` for invites). Enforced via `require_role()` and `can_edit_card()` in `server/app/utils/auth.py`. Editors can only edit their own cards; owner/admin can edit all. Invite codes generate workspace memberships.

## Frontend Pages

- `app/[locale]/login/` — 登录/注册（产品展示 + 主题切换；无微信/开发登录）
- `app/[locale]/workspaces/[id]/` — 三栏工作区（左卡片列表 / 中编辑器 / 右 AI 聊天），面板可见性由 `workspace-layout-store.ts`（Zustand，持久化 localStorage）管理；Cmd+K 全局搜索
  - 子页：`search`、`insights`（分支洞察）、`knowledge-graph`、`network`（图谱可视化）、`synthesis`（合成）、`activities`、`card/[cardId]`
- `app/[locale]/rag/` — 独立的 RAG 调试台（选择检索级别 + 查看上下文）
- `app/[locale]/settings/` — 模型 / 抽取 / fork / API keys（需 admin 白名单）

## LLM Provider Configuration

Providers configured via env vars in `server/.env`（见 `server/.env.example`）。默认 `DEFAULT_LLM_PROVIDER=claude`；`extraction_llm_provider` 可独立指定轻量任务（标题/关键词）的模型。Registry `providers/registry.py` 定义支持列表；新增 provider 只需加 `ProviderSpec` + 若非 OpenAI 兼容再加一个实现。

其他关键配置：
- Embedding：`EMBEDDING_PROVIDER=ollama|openai`（openai = OpenAI 兼容 API，如 SiliconFlow `BAAI/bge-m3`，1024 维）
- 限流：`RATE_LIMIT_BACKEND=memory|redis`，各端点独立窗口（auth 10/60s、ai 20/60s、rag 10/60s、ws 60/60s）
- 配额：`LLM_DAILY_QUOTA_TOKENS`（0=不限）
- Web 搜索：`WEB_SEARCH_PROVIDER=duckduckgo`(默认无 key) | brave | tavily | searxng | jina | kagi
- 管理：`ADMIN_USERNAMES`（逗号分隔，空则设置接口全 403）；服务器级设置写入 `.env`

## API Documentation

When the backend is running, Swagger UI is available at `http://localhost:8000/docs`.

## Conventions

- **Chinese-first**: UI text, system prompts, and extraction defaults are in Chinese. Full-text search supports zhparser/pg_jieba for Chinese tokenization.
- **Cursor-based pagination**: Card listing uses keyset pagination with `(sort_col, id)` tuples — not offset-based.
- **No SDK dependencies**: All LLM providers use raw `httpx` calls. Do not add provider SDKs.
- **Graph features**: knowledge graph triple extraction, entity linking, and graph-based retrieval (hop-traversal scoring) live in `server/app/services/`. All implemented in pure Python with SQLAlchemy + numpy — no PyTorch/torch dependency in the runtime.
- **后台任务纪律**: 任何重量级 LLM 管道都必须先落库（job/记录）再调度，禁止纯内存 fire-and-forget 丢失工作；加新 service 时按本文件的分组归位。
