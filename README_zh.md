<div align="center">

<img src="web/public/logo.png" alt="MindCard Logo" width="120" />

# MindCard

**AI 驱动的知识卡片管理平台**

捕捉灵感、连接知识、探索洞见

[![GitHub](https://img.shields.io/badge/GitHub-mindcard-181717?style=flat-square&logo=github)](https://github.com/wanxiayushaonian/mindcard)
[![Live Demo](https://img.shields.io/badge/Live_Demo-mindcard.online-blue?style=flat-square&logo=google-chrome)](http://mindcard.online)
[![Python](https://img.shields.io/badge/Python-3.12+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

[English](README.md) | **中文**

</div>

---

## MindCard 是什么？

MindCard 是一个**全栈知识管理平台**，将卡片式笔记与 AI 对话相结合。它帮助你捕捉灵感、自动发现知识之间的关联，并基于你的个人知识库进行有意义的 AI 对话。

**核心亮点：**
- **RAG 增强对话** — AI 回答基于你的卡片库，附带来源引用
- **知识拓扑** — 自动话题聚类 + 层级知识树
- **多模型切换** — DeepSeek、OpenAI、Claude、Gemini、Moonshot 无缝切换
- **全平台覆盖** — Web 应用、微信小程序、浏览器扩展

## 功能特性

### 卡片管理
- Markdown 富文本编辑器，支持实时预览
- 智能关键词提取（手动 + AI 自动）
- 情绪标签（8 种心情类型）
- 卡片关联 — 手动关联 + 关键词自动关联
- 收藏与临时卡片标记

### AI 对话与 RAG
- 工作区内流式 AI 对话
- 混合检索：BGE-M3 向量搜索 + PostgreSQL 全文搜索 + RRF 融合
- **引用溯源** — 点击 AI 回答中的引用卡片直接跳转
- **沉淀功能** — 选中 AI 回答，一键创建新卡片
- 可选 Web 搜索增强

### 知识拓扑
- 基于 pgvector 的自动语义聚类
- 层级知识树，支持父子节点关系
- **话题梳理** — AI 将聚类卡片整理为结构化笔记
- 4 种梳理模式：自由组织、时间线、论点-论据、对比分类
- AI 对话可 fork 为拓扑子节点

### 关联网络图
- D3.js 力导向图可视化
- 三种时间轴模式：全部 / 时间 / 事件
- 回放动画，展示知识积累过程
- 话题聚类圈叠加显示
- 节点拖拽、缩放、高亮交互

### 多模型支持
- 6 种 AI 提供商：DeepSeek、OpenAI、Claude、Gemini、Moonshot、自定义（OpenAI 兼容）
- 对话面板实时切换模型
- 动态模型列表，自动从 API 拉取可用模型
- 统一 Provider/Registry/Factory 架构，消费者代码零改动

### 浏览器扩展
- 一键保存网页内容为卡片
- AI 自动生成标题和关键词
- 支持 DeepSeek、ChatGPT、Claude 等平台
- Chrome 和 Firefox 双端支持（Manifest V3）

### 团队协作
- 基于工作区的邀请制
- 四级权限：Owner > Admin > Editor > Viewer
- 活动日志，记录所有卡片操作
- 通知系统，支持评论、邀请、活动提醒

## 架构概览

```
mindcard-workspace/
├── server/          # FastAPI 后端（异步 SQLAlchemy + PostgreSQL + pgvector）
├── web/             # Next.js 14 前端（Tailwind + SWR + D3.js）
├── miniapp/         # 微信小程序（Skyline 渲染器）
└── extensions/      # Chrome/Firefox 浏览器扩展（Web Clipper）
```

### 后端架构

```
┌─────────────────────────────────────────────────────┐
│                    FastAPI 服务                       │
├──────────┬──────────┬──────────┬──────────┬─────────┤
│  Cards   │   Chat   │   RAG    │ Topology │  Graph  │
│   API    │   API    │   API    │   API    │   API   │
├──────────┴──────────┴──────────┴──────────┴─────────┤
│                服务层（业务逻辑）                       │
├──────────┬──────────┬──────────┬──────────┬─────────┤
│ BGE-M3   │  LLM     │  Topic   │   RAG    │  Web    │
│ Embedding│ Provider │ Clustering│ Pipeline │ Search  │
├──────────┴──────────┴──────────┴──────────┴─────────┤
│          Provider Registry（工厂 + 注册表）            │
├──────────┬──────────┬──────────┬──────────┬─────────┤
│ DeepSeek │  OpenAI  │  Claude  │  Gemini  │ Moonshot│
└──────────┴──────────┴──────────┴──────────┴─────────┘
```

### RAG 检索层级

| 层级 | 说明 |
|------|------|
| `FREE` | 纯 LLM 对话，不检索 |
| `CARD` | 卡片级向量 + 全文检索 |
| `GRAPH` | 图增强检索（GNN） |
| `FULL` | 完整检索，含拓扑路径上下文 |

### 卡片创建流水线

```
卡片创建 → 向量生成 → 话题分配 → 拓扑分类 → 知识图谱三元组抽取
```

## 快速开始

### 环境要求

| 依赖 | 版本 |
|------|------|
| Python | 3.12+ |
| Node.js | 18+ |
| PostgreSQL | 15+（需 pgvector 扩展） |
| uv | 最新版（Python 包管理器） |

### 后端

```bash
cd server

# 1. 安装依赖
uv sync

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入至少一个 AI 提供商的 API Key：
#   DEEPSEEK_API_KEY=sk-xxx
#   OPENAI_API_KEY=sk-xxx
#   ANTHROPIC_API_KEY=sk-ant-xxx
#   GEMINI_API_KEY=xxx
#   MOONSHOT_API_KEY=sk-xxx

# 3. 启动数据库
docker compose up -d

# 4. 数据库迁移
uv run alembic upgrade head

# 5. 启动服务
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API 文档：http://localhost:8000/docs

### Web 前端

```bash
cd web
npm install
npm run dev
```

访问 http://localhost:3000

### 微信小程序

用微信开发者工具打开 `miniapp/` 目录。

### 浏览器扩展

1. Chrome 打开 `chrome://extensions/`，开启开发者模式
2. 加载已解压的扩展程序，选择 `extensions/mindcard-clipper/`
3. 在扩展选项中配置后端地址和 API Key

## 技术栈

| 层级 | 技术 |
|------|------|
| **Web 前端** | Next.js 14、React 18、Tailwind CSS、SWR、D3.js |
| **小程序** | 微信小程序、Skyline 渲染器 |
| **后端** | FastAPI、SQLAlchemy（异步）、Alembic |
| **数据库** | PostgreSQL 15+ 及 pgvector 扩展 |
| **搜索** | BGE-M3 向量嵌入、PostgreSQL 全文搜索、RRF 融合 |
| **AI 提供商** | DeepSeek、OpenAI、Claude、Gemini、Moonshot（raw httpx，无 SDK 依赖） |
| **Markdown** | react-markdown、remark-gfm、remark-math、rehype-katex |
| **浏览器扩展** | Chrome Extension Manifest V3 |

## AI 提供商配置

在 `server/.env` 中配置：

| 提供商 | 环境变量 | 默认模型 |
|--------|----------|----------|
| DeepSeek | `DEEPSEEK_API_KEY` | deepseek-chat |
| OpenAI | `OPENAI_API_KEY` | gpt-4o |
| Claude / Anthropic | `ANTHROPIC_API_KEY` | claude-sonnet-4-20250514 |
| Gemini | `GEMINI_API_KEY` | gemini-2.5-flash |
| Moonshot | `MOONSHOT_API_KEY` | moonshot-v1-8k |
| 自定义（OpenAI 兼容） | `CUSTOM_API_KEY` + `CUSTOM_BASE_URL` + `CUSTOM_MODEL` | — |

可选配置：
- `DEFAULT_LLM_PROVIDER` — 默认提供商（默认 deepseek）
- `DEFAULT_LLM_MODEL` — 默认模型（空则使用提供商默认）
- 各提供商 `*_BASE_URL` — 自定义 API 地址（代理 / 私有部署）

## 项目结构

```
server/
├── app/
│   ├── api/           # 路由处理器：cards、chat、rag、search、topics、topology、auth...
│   ├── models/        # SQLAlchemy ORM：Card、User、Workspace、Chat、Topic、Topology...
│   ├── schemas/       # Pydantic 请求/响应模型
│   ├── services/      # 业务逻辑：embedding、search、rag、topic、llm、recommendation
│   ├── providers/     # LLM 提供商抽象（工厂 + 注册表模式）
│   └── utils/         # 认证、限流、微信集成、游标分页
└── alembic/           # 数据库迁移

web/
├── app/
│   └── [locale]/      # Next.js App Router + i18n
│       ├── workspaces/ # 工作区页面（卡片列表、编辑器、AI 对话）
│       ├── rag/        # RAG 对话页面
│       └── settings/   # 设置页面
├── components/         # React 组件
└── lib/                # API 客户端、状态管理（Zustand）、工具函数

miniapp/
├── pages/             # 微信小程序页面
│   ├── index/         # 首页
│   ├── workspace/     # 工作区
│   ├── ai-chat/       # AI 对话
│   └── card-detail/   # 卡片详情
└── components/        # 共享组件

extensions/
└── mindcard-clipper/  # 浏览器扩展（Chrome + Firefox）
```

## 参与贡献

欢迎提交 Pull Request！

1. Fork [本仓库](https://github.com/wanxiayushaonian/mindcard)
2. 创建功能分支（`git checkout -b feature/amazing-feature`）
3. 提交更改（`git commit -m 'feat: add amazing feature'`）
4. 推送分支（`git push origin feature/amazing-feature`）
5. 创建 Pull Request

## 开源许可

本项目基于 MIT 许可证开源。

---

<div align="center">

**[mindcard.online](http://mindcard.online)** · 用心构建 ❤️

</div>
