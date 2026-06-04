# Stello Fork Engine Adoption — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace MindCard's ad-hoc fork system with Stello's `@stello-ai/core` engine, providing true isolated conversation branches with cross-session context sharing.

**Architecture:** A Node.js sidecar service wraps `@stello-ai/core` and exposes HTTP APIs for session management. MindCard's Python FastAPI proxies new conversation operations to this sidecar. Old conversations remain unchanged (forward-only migration).

**Tech Stack:** `@stello-ai/core`, Node.js + Fastify, PostgreSQL (shared instance, separate tables), Next.js frontend

---

## Problem Statement

MindCard's current fork feature has three critical issues:

1. **Fake forks** — Inline fork dividers (`role="fork-divider"`) are visual-only separators within a single chat. They don't create isolated conversation branches. The actual `POST /fork` API creates child `AiChat` rows but the UI conflates both models.

2. **Two competing models** — Inline dividers (within one chat) vs. child chats (separate `AiChat` rows with `parent_chat_id`) coexist confusingly. Neither model is complete.

3. **No user control** — Auto-fork via topic drift detection (cosine similarity < 0.7) happens silently with no review, threshold control, or undo capability.

## Solution: Stello Engine Adoption

Adopt `@stello-ai/core` as the conversation topology engine. Stello provides:

- **Isolated sessions** — Each branch is a standalone Session with its own message history
- **Three-slot context model** — `systemPrompt` (persistent, injected every call), `insight` (one-shot inbox), `memory` (external description for other sessions)
- **Fork-compress** — When forking, parent context is compressed and injected into child's `systemPrompt`
- **Cross-branch communication** — Via `SharedMemoryStore` and `refs` (topology links between non-parent-child nodes)
- **Topology tree** — Forest of `TopologyNode` objects with `parentId`, `children`, `refs`, `depth`, `index`, `label`

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Browser (Next.js)                  │
│                                                      │
│  AiChatPanel                                         │
│    ├── Old chats → existing chatApi (unchanged)      │
│    └── New chats → stelloApi (new)                   │
│              │                                       │
│         HTTP/WebSocket                               │
│              │                                       │
│              ▼                                       │
│       Python FastAPI                                 │
│         ├── Auth, RAG, cards, web search (unchanged) │
│         ├── Old chat endpoints (unchanged)            │
│         └── New session proxy → Node.js Stello Svc   │
│                                      │               │
│                                 @stello-ai/core      │
│                                      │               │
│                                 PostgreSQL           │
│                              (stello_* tables)       │
└─────────────────────────────────────────────────────┘
```

### Performance Impact

The sidecar is **NOT** in the LLM streaming path:

| Operation | Path | Latency Impact |
|-----------|------|---------------|
| LLM streaming | Browser → Python → LLM → stream back | None (unchanged) |
| RAG retrieval | Python → embedding + search | None (unchanged) |
| Session create | Python → Node.js sidecar → DB | +10-50ms (one-time) |
| Session fork | Python → Node.js sidecar → DB | +10-50ms (one-time) |
| Load history | Python → Node.js sidecar → DB | +10-50ms (one-time) |

All real-time streaming stays in Python. The sidecar handles session state management only.

## Data Model

### Stello Tables (new, in shared PostgreSQL)

```sql
-- Session metadata + topology
CREATE TABLE stello_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES stello_sessions(id),
    label TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'archived'
    turn_count INTEGER NOT NULL DEFAULT 0,
    depth INTEGER NOT NULL DEFAULT 0,
    index_in_siblings INTEGER NOT NULL DEFAULT 0,
    source_session_id UUID,  -- fork context source
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Session messages
CREATE TABLE stello_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES stello_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,  -- 'user' | 'assistant' | 'system'
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cross-branch references
CREATE TABLE stello_refs (
    from_id UUID NOT NULL REFERENCES stello_sessions(id) ON DELETE CASCADE,
    to_id UUID NOT NULL REFERENCES stello_sessions(id) ON DELETE CASCADE,
    PRIMARY KEY (from_id, to_id)
);

-- Shared memory (cross-session context)
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

### Mapping to Stello Concepts

| Stello Concept | MindCard Implementation |
|---------------|------------------------|
| `SessionMeta.id` | `stello_sessions.id` (UUID) |
| `TopologyNode.parentId` | `stello_sessions.parent_id` |
| `TopologyNode.children` | Derived from `parent_id` query |
| `TopologyNode.refs` | `stello_refs` table |
| `SessionTree.getTree()` | Recursive CTE on `stello_sessions` |
| `SharedMemoryStore` | `stello_shared_memory` table |
| `FileSystemAdapter` | `PgAdapter` (new, implements Stello's storage interface) |
| Session files (memory.md, scope.md, index.md) | `stello_shared_memory` rows |

### MindCard ↔ Stello Session Linking

Each MindCard `AiChat` (old model) remains unchanged. New conversations create a Stello session AND a lightweight `AiChat` row for backward compatibility:

```
AiChat.id = UUID
AiChat.stello_session_id = UUID (nullable, set for new chats)
AiChat.workspace_id = UUID
AiChat.title = TEXT
AiChat.mode = 'stello' (new mode value)
```

The `stello_session_id` links to Stello's session. Old chats have `stello_session_id = NULL`.

## Node.js Sidecar Service

### Package Structure

```
server/stello-service/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Fastify HTTP server
│   ├── routes/
│   │   ├── session.ts        # CRUD, fork, messages
│   │   └── topology.ts       # Tree queries
│   ├── adapters/
│   │   └── pg-adapter.ts     # PostgreSQL implementation of Stello's storage
│   ├── bridge.ts             # Maps MindCard RAG context → systemPrompt
│   └── types.ts              # Shared types
└── dist/
```

### Key API Endpoints

```
POST   /api/sessions
  Body: { workspace_id, parent_id?, label?, source_session_id? }
  Returns: { id, topology_node }

GET    /api/sessions/:id
  Returns: { session_meta, topology_node, config }

POST   /api/sessions/:id/messages
  Body: { role, content, metadata? }
  Returns: { message }
  Side-effect: updates turn_count, last_active_at

POST   /api/sessions/:id/fork
  Body: { label?, context_strategy?: 'none'|'inherit'|'compress' }
  Returns: { child_session, topology_node }

GET    /api/sessions/:id/messages
  Returns: { messages[] }

GET    /api/sessions/:id/tree
  Returns: { tree: SessionTreeNode }

GET    /api/sessions/:id/ancestors
  Returns: { ancestors: TopologyNode[] }

POST   /api/sessions/:id/memory
  Body: { slug, body }
  Returns: { entry }

GET    /api/sessions/:id/memory
  Returns: { entries: SharedMemoryEntry[] }

DELETE /api/sessions/:id
  Returns: { ok: true }

GET    /api/workspaces/:wid/sessions
  Returns: { roots: SessionTreeNode[] }
```

### PgAdapter

Implements Stello's storage interface using PostgreSQL instead of filesystem:

- `createSession()` → INSERT into `stello_sessions`
- `get(id)` → SELECT from `stello_sessions`
- `listAll()` → SELECT with workspace filter
- `getTree()` → Recursive CTE
- `getAncestors(id)` → Walk parent_id chain
- `getSiblings(id)` → Same parent_id
- Messages → `stello_messages` table
- Memory → `stello_shared_memory` table
- Refs → `stello_refs` table

### WebSocket Streaming for Stello Sessions

The existing WebSocket handler (`server/app/api/ws.py`) continues to handle LLM streaming. For Stello sessions:

1. Client sends `rag` event with `stello_session_id` instead of `chat_id`
2. Python handler loads session context from sidecar: `GET /api/stello/sessions/{id}` + `GET /api/stello/sessions/{id}/messages`
3. Builds `systemPrompt` from: RAG context + workspace prompt + Stello session's existing system prompt
4. Sends history from Stello messages (not `ChatMessage` table)
5. Streams LLM response via same WebSocket
6. On stream complete: saves assistant message to sidecar: `POST /api/stello/sessions/{id}/messages`
7. Auto-fork detection: Python calls sidecar's fork endpoint if drift detected, sends `auto_fork` event to client

The WebSocket protocol (event types: `content`, `sources`, `done`, `error`, `auto_fork`) stays identical. Only the data source changes.

### Fork-Compress Integration

When a fork is triggered (manual or auto):

1. Create child session via `SessionTree.createSession({ parentId, sourceSessionId })`
2. Apply fork-compress strategy:
   - `'compress'`: Read parent messages, call LLM to summarize, append to child's `systemPrompt`
   - `'inherit'`: Copy parent's `systemPrompt` as-is
   - `'none'`: No context transfer
3. Update parent's `memory.md` with branch summary
4. Return child session ID to MindCard

MindCard's Python backend calls the sidecar with the chosen strategy. Default: `'compress'` for auto-forks, `'inherit'` for manual forks.

## Frontend Changes

### New API Client

`web/lib/stello-api.ts` — Thin client for the Stello session endpoints, proxied through MindCard's FastAPI:

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

### AiChatPanel Changes

**Session mode detection:**
```ts
const isStelloSession = chatId && chat?.mode === 'stello';
```

- Old chats (`mode !== 'stello'`): render via existing logic, inline fork dividers, breadcrumbs
- New chats (`mode === 'stello'`): use `stelloApi`, render branch tree

**Branch tree UI (inline horizontal, replaces breadcrumb):**

```
── "探索RAG原理" ──┬── "向量检索细节" (current, highlighted)
                  └── "图谱增强方案"
```

- Each node shows truncated session label
- Current branch highlighted with primary color
- Click to switch branches (loads that session's messages)
- "+" button at any node to fork from that point
- Hover shows full label + message count
- Horizontal scroll if tree exceeds width

**Fork trigger:**
- Remove the "fork mode" toggle button
- Replace with: press Enter with a special prefix (e.g., `// `) OR click "+" on a tree node
- Manual fork creates child session, loads it immediately
- Auto-fork: server-side detection via Stello's engine, sends `auto_fork` WebSocket event

**Cross-branch insight indicator:**
- Small badge on the branch tree showing insight count from sibling branches
- Clicking expands a dropdown showing insights
- User can "inject" an insight into current session's context

### Forward-Only Migration

- Old chats: `chatApi.get()`, `chatApi.list()` — unchanged rendering
- New chats: `stelloApi.getSession()`, `stelloApi.getMessages()` — new rendering
- History panel: groups old chats by `parent_chat_id`, groups new sessions by Stello tree
- Visual distinction: new sessions show a small tree icon badge

## Configuration

### Environment Variables (server/.env)

```env
# Stello sidecar
STELLO_SERVICE_URL=http://localhost:3001
STELLO_ENABLED=true

# Fork behavior
STELLO_AUTO_FORK=true
STELLO_FORK_CONTEXT_STRATEGY=compress  # none | inherit | compress
STELLO_DRIFT_THRESHOLD=0.7
```

### Settings UI

Add "对话分叉" section to settings page:
- Auto-fork toggle (on/off)
- Context strategy selector (none/inherit/compress)
- Drift threshold slider (0.5-0.9)

## Implementation Phases

### Phase 1: Sidecar Foundation
- Initialize `server/stello-service/` with TypeScript + Fastify
- Install `@stello-ai/core`
- Implement `PgAdapter` for Stello's storage interface
- Create PostgreSQL migration for `stello_*` tables
- Implement Session CRUD + message endpoints
- Docker compose: add stello-service container
- Health check endpoint
- Unit tests for PgAdapter

### Phase 2: Backend Integration
- Add `stello_session_id` column to `AiChat` model (nullable)
- Add `mode='stello'` support to chat creation
- Python proxy routes: `/api/stello/*` → sidecar
- WebSocket handler: route new sessions through Stello
- RAG context injection into Stello's `systemPrompt`
- Fork-compress integration with MindCard's LLM service
- Auto-fork detection delegated to Stello engine
- Old chat endpoints unchanged

### Phase 3: Frontend
- Create `web/lib/stello-api.ts`
- Update AiChatPanel: detect session mode, branch accordingly
- Implement inline horizontal tree UI
- Branch switching logic
- Fork trigger (replacing fork mode toggle)
- Cross-branch insight indicators
- Old chat rendering preserved
- Settings UI for fork configuration

## Testing Strategy

- **Unit tests:** PgAdapter CRUD, fork-compress, tree queries
- **Integration tests:** Sidecar HTTP API, Python proxy routes
- **E2E tests:** Create session → send messages → fork → switch branches → verify isolation
- **Regression tests:** Old chat rendering unchanged, inline fork dividers still work for old chats

## Deployment

```yaml
# docker-compose.yml addition
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

Single `docker compose up` starts all services. The sidecar shares PostgreSQL with MindCard but uses its own tables.
