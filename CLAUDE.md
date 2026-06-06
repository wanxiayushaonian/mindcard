# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MindCard — a knowledge card management platform with WeChat mini-program, Python backend, and Next.js web frontend. Features include card CRUD with Markdown, AI-powered RAG conversations, topic clustering (pgvector), knowledge topology tree, and multi-provider LLM support.

## Architecture

```
mindcard-workspace/
├── server/          # FastAPI backend (async SQLAlchemy + PostgreSQL + pgvector)
├── web/             # Next.js 14 App Router frontend (Tailwind + SWR + D3.js)
├── miniapp/         # WeChat mini-program (Skyline renderer)
└── extensions/      # Chrome/Firefox browser extension (Web Clipper)
```

### Server (`server/app/`)

- **api/** — FastAPI route handlers organized by domain: `cards`, `chat`, `rag`, `search`, `topics`, `topology`, `auth`, `workspaces`, `activities`, `comments`, `notifications`, `external`
- **models/** — SQLAlchemy ORM models (Card, User, Workspace, Chat, Topic, Topology, etc.)
- **schemas/** — Pydantic request/response schemas mirroring models
- **services/** — Business logic: `embedding.py` (BGE-M3 vectorization), `search.py` (hybrid search), `rag.py` (RAG pipeline), `topic.py` (clustering), `llm.py` (multi-provider orchestration), `recommendation.py`, `web_search.py`
- **providers/** — LLM provider abstraction using **Factory + Registry pattern**:
  - `registry.py` — `ProviderSpec` frozen dataclass; `PROVIDERS` dict maps provider names to specs
  - `factory.py` — `make_provider()` resolves name → concrete `LLMProvider`
  - `base.py` — `LLMProvider` abstract base class
  - `openai_compat.py` — OpenAI-compatible provider (DeepSeek, OpenAI, Gemini, Moonshot, custom)
  - `anthropic.py` — Anthropic-specific provider
- **utils/** — Auth helpers, rate limiting, WeChat integration, cursor pagination

Web frontend uses `lib/api.ts` for all HTTP calls (JWT from localStorage, SSE streaming via `streamRequest`), and `lib/store.ts` for Zustand auth state.

### Key Patterns

- All LLM calls go through the Provider Registry — consumer code calls `make_provider()` and uses the `LLMProvider` interface
- All providers use raw `httpx` (no SDK dependencies) with exponential backoff retry for 429/5xx errors
- Search uses RRF (Reciprocal Rank Fusion) to combine BGE-M3 vector search with PostgreSQL full-text search
- AI chat uses SSE streaming; frontend consumes via `streamRequest()` in `lib/api.ts`
- Frontend data fetching: SWR for REST endpoints, manual fetch for SSE
- Auth: JWT tokens stored in localStorage, attached via `Authorization: Bearer` header

### RAG Retrieval Levels

The `RetrievalDispatcher` (`services/retrieval_dispatcher.py`) routes queries through 4 depth levels:
- `FREE` — pure LLM chat, no retrieval
- `CARD` — card-level vector + fulltext retrieval
- `GRAPH` — graph-enhanced retrieval via GNN
- `FULL` — full retrieval with topology path context

Frontend controls retrieval depth per query. Auto-detection is also supported.

### Background Task Chain

Card creation triggers a chain via FastAPI `BackgroundTasks`:
`embedding generation → topic assignment → topology classification → knowledge graph triple extraction`

### Topology Tree

Each workspace has a topology tree (parent-child hierarchy of knowledge nodes). Chat conversations can be "forked" into child topology nodes. The topology path is injected into RAG context at the `FULL` retrieval level.

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

- PostgreSQL 15+ with pgvector extension
- Alembic for migrations (`server/alembic/`)
- Connection: `postgresql+asyncpg://mindcard:mindcard@localhost:5432/mindcard`
- Redis for caching (optional, used alongside PostgreSQL)

## Workspace Collaboration

Four-tier role system: `owner > admin > editor > viewer` (+ `pending` for invites). Enforced via `require_role()` and `can_edit_card()` in `server/app/utils/auth.py`. Editors can only edit their own cards; owner/admin can edit all. Invite codes generate workspace memberships.

## Frontend Workspace Layout

The workspace page (`web/app/workspaces/[id]/layout.tsx`) uses a collapsible three-panel design:
- **Left**: Card list with filters
- **Middle**: Card editor
- **Right**: AI chat panel

Panel visibility is managed by `usePanelStore` (Zustand, persisted to localStorage). Cmd+K opens the global search modal.

## LLM Provider Configuration

Providers are configured via env vars in `server/.env`. The system auto-detects which providers have valid API keys. The Provider Registry in `server/app/providers/registry.py` defines supported providers and their defaults. Adding a new provider requires only adding a `ProviderSpec` entry and, if non-OpenAI-compatible, a new backend implementation.

## API Documentation

When the backend is running, Swagger UI is available at `http://localhost:8000/docs`.

## Conventions

- **Chinese-first**: UI text, system prompts, and extraction defaults are in Chinese. Full-text search supports zhparser/pg_jieba for Chinese tokenization.
- **Cursor-based pagination**: Card listing uses keyset pagination with `(sort_col, id)` tuples — not offset-based.
- **No SDK dependencies**: All LLM providers use raw `httpx` calls. Do not add provider SDKs.
- **Graph features**: GNN training (PyTorch), knowledge graph triple extraction, entity linking, and graph-based retrieval live in `server/app/services/`. Training can run locally or on Modal Labs remote GPU.
