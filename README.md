# MindCard Workspace

灵感卡片管理平台 — 微信小程序 + Python 后端 + Web 前端

## 项目结构

```
mindcard-workspace/
├── miniapp/          # 微信小程序（Skyline 渲染器）
├── server/           # Python FastAPI 后端（PostgreSQL + pgvector）
└── web/              # Next.js Web 前端（待创建）
```

## 快速开始

### 小程序
用微信开发者工具打开 `miniapp/` 目录。

### 后端
```bash
cd server
cp .env.example .env  # 填入 API Key
docker compose up -d   # PostgreSQL + Redis
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

### Web 端
待创建。

## 技术栈

| 组件 | 技术 |
|------|------|
| 小程序 | 微信小程序 + Skyline + 云开发 |
| 后端 | FastAPI + SQLAlchemy + PostgreSQL + pgvector |
| 搜索 | BGE-M3 向量搜索 + PostgreSQL 全文搜索 + RRF 融合 |
| RAG | DeepSeek API + LlamaIndex |
| Web | Next.js 14 + Tailwind CSS (计划中) |
