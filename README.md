<div align="center">

<img src="web/public/logo.png" alt="MindCard Logo" width="120" />

# MindCard

**AI-Powered Knowledge Card Management Platform**

Capture ideas, connect knowledge, and explore insights with AI

[![GitHub](https://img.shields.io/badge/GitHub-mindcard-181717?style=flat-square&logo=github)](https://github.com/wanxiayushaonian/mindcard)
[![Live Demo](https://img.shields.io/badge/Live_Demo-mindcard.online-blue?style=flat-square&logo=google-chrome)](http://mindcard.online)
[![Python](https://img.shields.io/badge/Python-3.12+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

**English** | [中文](README_zh.md)

</div>

---

## What is MindCard?

MindCard is a **full-stack knowledge management platform** that combines card-based note-taking with AI-powered conversations. It helps you capture ideas, automatically discover connections between knowledge, and have meaningful AI discussions grounded in your personal knowledge base.

**Key differentiators:**
- **RAG-powered AI chat** — AI answers are grounded in your cards with source citations
- **Knowledge topology** — automatic topic clustering and hierarchical knowledge tree
- **Conversation branching** — fork any AI chat into a topology child node with a focused profile
- **Workspace memory** — AI autonomously maintains persistent, slug-keyed memory entries
- **Multi-provider LLM** — switch between DeepSeek, OpenAI, Claude, Gemini, Moonshot seamlessly
- **Cross-platform** — Web app, WeChat mini-program, and browser extension

## Features

### Card Management
- Rich Markdown editor with wiki-link support (`[[card title]]` inline card references)
- Smart keyword extraction (manual + AI-powered)
- Emotion tagging (8 mood types)
- Card linking — manual associations + automatic keyword-based connections
- Favorites and temporary card markers

### AI Conversation & RAG
- Streaming AI chat via SSE and WebSocket
- Hybrid retrieval: BGE-M3 vector search + PostgreSQL full-text search + RRF fusion
- **Source citation** — click referenced cards in AI answers to jump to source
- **Crystallize** — select AI response text and save as a new card in one click
- Optional web search augmentation (6 providers: DuckDuckGo, Brave, Tavily, SearXNG, Jina, Kagi)
- Real-time model switching in the chat panel

### Conversation Branching (Fork)
- Fork any AI conversation into a topology child node to explore a sub-topic in depth
- 4 branch profiles: **Deep Dive** (深入探讨), **Explore** (发散探索), **Summarize** (总结提炼), **Challenge** (质疑挑战)
- Fork compression carries essential context without duplicating full history
- Split guard prevents runaway auto-forking (configurable minimum message threshold)
- Per-chat branch insights and conversation path navigation

### Workspace Memory
- AI autonomously maintains persistent, slug-keyed Markdown memory entries during chat
- `memory_edit` tool lets AI upsert or delete memories in real-time as it learns context
- Memories are injected into the RAG context for personalized, continuity-aware responses
- View and edit memories manually via the Memory panel

### Knowledge Topology
- Automatic topic clustering based on pgvector semantic similarity
- Hierarchical knowledge tree with parent-child node relationships
- **Topic Synthesis** — AI organizes clustered cards into structured notes
- 4 synthesis modes: Free-form, Timeline, Argument-Evidence, Compare-Contrast
- Saveable synthesis templates for reusable configurations
- Fork AI conversations into topology child nodes

### Knowledge Graph
- LLM-based triple extraction: entities + relations from card content
- Embedding-based entity linking and deduplication
- Leiden-algorithm community detection with LLM-generated community reports
- D3.js force-directed graph visualization
- Three timeline modes: All / Time / Events
- Playback animation showing knowledge accumulation over time
- GNN-enhanced graph retrieval with reasoning paths
- HNSW index for fast approximate graph search

### Multi-Model Support
- 6 AI providers: DeepSeek, OpenAI, Claude, Gemini, Moonshot, Custom (OpenAI-compatible)
- Real-time model switching in chat panel
- Dynamic model list fetched from provider APIs
- Unified Provider/Registry/Factory architecture — zero consumer code changes
- Separate extraction provider/language settings for triple extraction

### Browser Extension
- One-click save web content as cards
- AI auto-generates titles and keywords
- Works with DeepSeek, ChatGPT, Claude platforms
- Chrome & Firefox support (Manifest V3)

### Team Collaboration
- Workspace-based with invite system (6-character invite codes)
- Four-tier roles: Owner > Admin > Editor > Viewer
- Activity logging for all card operations
- Notification system for comments, invites, and activity
- Per-user API key management for external access

### Web Frontend
- Full bilingual UI — English and Chinese (i18n via Next.js `[locale]` routing)
- WeChat Web OAuth login (QR-code scan)
- Collapsible three-panel layout: card list · editor · AI chat
- Global search modal (Cmd+K)

## Architecture

```
mindcard-workspace/
├── server/          # FastAPI backend (async SQLAlchemy + PostgreSQL + pgvector)
├── web/             # Next.js 14 App Router frontend (Tailwind + SWR + D3.js)
├── miniapp/         # WeChat mini-program (Skyline renderer)
└── extensions/      # Chrome/Firefox browser extension (Web Clipper)
```

### Backend Architecture

```
┌─────────────────────────────────────────────────────┐
│                    FastAPI Server                     │
├──────────┬──────────┬──────────┬──────────┬─────────┤
│  Cards   │   Chat   │   RAG    │ Topology │  Graph  │
│   API    │   API    │   API    │   API    │   API   │
├──────────┴──────────┴──────────┴──────────┴─────────┤
│              Service Layer (Business Logic)           │
├──────────┬──────────┬──────────┬──────────┬─────────┤
│ BGE-M3   │  LLM     │  Topic   │   RAG    │  Web    │
│ Embedding│ Provider │ Clustering│ Pipeline │ Search  │
├──────────┴──────────┴──────────┴──────────┴─────────┤
│        Provider Registry (Factory + Registry)         │
├──────────┬──────────┬──────────┬──────────┬─────────┤
│ DeepSeek │  OpenAI  │  Claude  │  Gemini  │ Moonshot│
└──────────┴──────────┴──────────┴──────────┴─────────┘
```

### RAG Retrieval Levels

| Level | Description |
|-------|-------------|
| `FREE` | Pure LLM chat, no retrieval |
| `CARD` | Card-level vector + fulltext retrieval |
| `GRAPH` | Graph-enhanced retrieval via GNN |
| `FULL` | Full retrieval with topology path context |

### Card Creation Pipeline

```
Card Created → Embedding Generation → Topic Assignment → Topology Classification → Graph Triple Extraction
```

## Quick Start

### Prerequisites

| Dependency | Version |
|-----------|---------|
| Python | 3.12+ |
| Node.js | 18+ |
| PostgreSQL | 15+ (with pgvector extension) |
| uv | Latest (Python package manager) |

### Backend

```bash
cd server

# 1. Install dependencies
uv sync

# 2. Configure environment
cp .env.example .env
# Edit .env — add at least one AI provider API key:
#   DEEPSEEK_API_KEY=sk-xxx
#   OPENAI_API_KEY=sk-xxx
#   ANTHROPIC_API_KEY=sk-ant-xxx
#   GEMINI_API_KEY=xxx
#   MOONSHOT_API_KEY=sk-xxx

# 3. Start database
docker compose up -d

# 4. Run migrations
uv run alembic upgrade head

# 5. Start server
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs: http://localhost:8000/docs

### Web Frontend

```bash
cd web
npm install
npm run dev
```

Visit http://localhost:3000

### WeChat Mini-Program

Open `miniapp/` in WeChat DevTools.

### Browser Extension

1. Open `chrome://extensions/` with Developer Mode enabled
2. Load unpacked → select `extensions/mindcard-clipper/`
3. Configure backend URL and API key in extension options

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Web Frontend** | Next.js 14, React 18, Tailwind CSS, SWR, D3.js, i18n (EN/ZH) |
| **Mini-Program** | WeChat Mini-Program, Skyline Renderer |
| **Backend** | FastAPI, SQLAlchemy (async), Alembic |
| **Database** | PostgreSQL 15+ with pgvector extension |
| **Search** | BGE-M3 embeddings (Ollama), PostgreSQL full-text, RRF fusion |
| **AI Providers** | DeepSeek, OpenAI, Claude, Gemini, Moonshot (raw httpx, no SDK) |
| **Real-time** | SSE streaming + WebSocket unified endpoint |
| **Graph** | GNN retrieval, Leiden community detection, HNSW index |
| **Markdown** | react-markdown, remark-gfm, remark-math, rehype-katex |
| **Extension** | Chrome/Firefox Extension Manifest V3 |

## AI Provider Configuration

Configure in `server/.env`:

| Provider | Env Variable | Default Model |
|----------|-------------|---------------|
| DeepSeek | `DEEPSEEK_API_KEY` | deepseek-chat |
| OpenAI | `OPENAI_API_KEY` | gpt-4o |
| Claude / Anthropic | `ANTHROPIC_API_KEY` | claude-sonnet-4-20250514 |
| Gemini | `GEMINI_API_KEY` | gemini-2.5-flash |
| Moonshot | `MOONSHOT_API_KEY` | moonshot-v1-8k |
| Custom (OpenAI-compat) | `CUSTOM_API_KEY` + `CUSTOM_BASE_URL` + `CUSTOM_MODEL` | — |

Optional:
- `DEFAULT_LLM_PROVIDER` — default provider (default: deepseek)
- `DEFAULT_LLM_MODEL` — default model (empty = provider default)
- `*_BASE_URL` per provider — custom API endpoint (proxy / self-hosted)

## Project Structure

```
server/
├── app/
│   ├── api/           # Route handlers: cards, chat, rag, search, topics, topology, graph, auth, settings, ws...
│   ├── models/        # SQLAlchemy ORM: Card, User, Workspace, Chat, Topic, Topology, GraphEntity, Memory...
│   ├── schemas/       # Pydantic request/response schemas
│   ├── services/      # Business logic: embedding, search, rag, topic, llm, fork, consolidation, graph, memory
│   ├── providers/     # LLM provider abstraction (Factory + Registry pattern)
│   ├── tools/         # LLM-callable tools: memory_edit, create_fork
│   └── utils/         # Auth, rate limiting, WeChat integration, cursor pagination
└── alembic/           # Database migrations (20 versioned migrations)

web/
├── app/
│   └── [locale]/      # Next.js App Router with i18n (en / zh)
│       ├── workspaces/[id]/  # Workspace layout (cards · editor · chat)
│       │   ├── activities/   # Activity feed
│       │   ├── insights/     # AI workspace insights
│       │   ├── knowledge-graph/ # D3.js graph view
│       │   ├── network/      # Network view
│       │   ├── search/       # Search page
│       │   └── synthesis/    # Topic synthesis with templates
│       ├── rag/         # Standalone RAG page
│       └── settings/    # models / api-keys / extraction / fork
├── components/         # React components (100+ including AiChatPanel, EditorPanel, TopologyTreeView...)
└── lib/                # API client, Zustand stores, synthesis-draft, unified-ws, i18n utils

miniapp/
├── pages/             # WeChat mini-program pages
│   ├── index/         # Home — quick capture, recent cards
│   ├── workspace/     # Workspace switcher
│   ├── card-detail/   # Card detail + relations + comments
│   ├── card-edit/     # Create / edit card with AI tools
│   ├── ai-chat/       # Streaming AI chat (SSE)
│   ├── search/        # Hybrid / semantic / fulltext search
│   └── profile/       # User profile + settings
├── components/        # card-item, card-picker, icon, markdown-render, navigation-bar
└── services/          # card-service, chat-service, notification-service, workspace-service

extensions/
└── mindcard-clipper/  # Browser extension (Chrome + Firefox, Manifest V3)
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork [the repository](https://github.com/wanxiayushaonian/mindcard)
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.

---

<div align="center">

**[mindcard.online](http://mindcard.online)** · Built with ❤️

</div>
