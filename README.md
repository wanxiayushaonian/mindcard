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
- **Multi-provider LLM** — switch between DeepSeek, OpenAI, Claude, Gemini, Moonshot seamlessly
- **Cross-platform** — Web app, WeChat mini-program, and browser extension

## Features

### Card Management
- Rich Markdown editor with live preview
- Smart keyword extraction (manual + AI-powered)
- Emotion tagging (8 mood types)
- Card linking — manual associations + automatic keyword-based connections
- Favorites and temporary card markers

### AI Conversation & RAG
- Streaming AI chat within each workspace
- Hybrid retrieval: BGE-M3 vector search + PostgreSQL full-text search + RRF fusion
- **Source citation** — click referenced cards in AI answers to jump to source
- **Crystallize** — select AI response text and save as a new card in one click
- Optional web search augmentation

### Knowledge Topology
- Automatic topic clustering based on pgvector semantic similarity
- Hierarchical knowledge tree with parent-child node relationships
- "Topic Synthesis" — AI organizes clustered cards into structured notes
- 4 synthesis modes: Free-form, Timeline, Argument-Evidence, Compare-Contrast
- Fork AI conversations into topology child nodes

### Knowledge Graph
- D3.js force-directed graph visualization
- Three timeline modes: All / Time / Events
- Playback animation showing knowledge accumulation over time
- Topic cluster overlay with heat circles
- Node drag, zoom, and highlight interactions

### Multi-Model Support
- 6 AI providers: DeepSeek, OpenAI, Claude, Gemini, Moonshot, Custom (OpenAI-compatible)
- Real-time model switching in chat panel
- Dynamic model list fetched from provider APIs
- Unified Provider/Registry/Factory architecture — zero consumer code changes

### Browser Extension
- One-click save web content as cards
- AI auto-generates titles and keywords
- Works with DeepSeek, ChatGPT, Claude platforms
- Chrome & Firefox support (Manifest V3)

### Team Collaboration
- Workspace-based with invite system
- Four-tier roles: Owner > Admin > Editor > Viewer
- Activity logging for all card operations
- Notification system for comments, invites, and activity

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
| **Web Frontend** | Next.js 14, React 18, Tailwind CSS, SWR, D3.js |
| **Mini-Program** | WeChat Mini-Program, Skyline Renderer |
| **Backend** | FastAPI, SQLAlchemy (async), Alembic |
| **Database** | PostgreSQL 15+ with pgvector extension |
| **Search** | BGE-M3 embeddings, PostgreSQL full-text, RRF fusion |
| **AI Providers** | DeepSeek, OpenAI, Claude, Gemini, Moonshot (raw httpx, no SDK) |
| **Markdown** | react-markdown, remark-gfm, remark-math, rehype-katex |
| **Extension** | Chrome Extension Manifest V3 |

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
│   ├── api/           # Route handlers: cards, chat, rag, search, topics, topology, auth, ...
│   ├── models/        # SQLAlchemy ORM: Card, User, Workspace, Chat, Topic, Topology, ...
│   ├── schemas/       # Pydantic request/response schemas
│   ├── services/      # Business logic: embedding, search, rag, topic, llm, recommendation
│   ├── providers/     # LLM provider abstraction (Factory + Registry pattern)
│   └── utils/         # Auth, rate limiting, WeChat integration, cursor pagination
└── alembic/           # Database migrations

web/
├── app/
│   └── [locale]/      # Next.js App Router with i18n
│       ├── workspaces/ # Workspace pages (card list, editor, AI chat)
│       ├── rag/        # RAG conversation page
│       └── settings/   # Settings page
├── components/         # React components
└── lib/                # API client, store (Zustand), utilities

miniapp/
├── pages/             # WeChat mini-program pages
│   ├── index/         # Home page
│   ├── workspace/     # Workspace
│   ├── ai-chat/       # AI conversation
│   └── card-detail/   # Card detail view
└── components/        # Shared components

extensions/
└── mindcard-clipper/  # Browser extension (Chrome + Firefox)
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
