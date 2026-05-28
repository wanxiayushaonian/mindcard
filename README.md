# MindCard Workspace

灵感卡片管理平台 — 微信小程序 + Python 后端 + Web 前端

## 项目结构

```
mindcard-workspace/
├── miniapp/          # 微信小程序（Skyline 渲染器）
├── extensions/       # 浏览器扩展（Web Clipper）
├── server/           # Python FastAPI 后端（PostgreSQL + pgvector）
└── web/              # Next.js Web 前端（Tailwind CSS）
```

## 核心功能

### 卡片管理
- 创建、编辑、删除卡片，支持 Markdown 富文本
- 关键词标签（手动 + AI 自动提取）
- 情绪标签（开心、难过、焦虑等 8 种）
- 收藏、临时卡片标记
- 卡片关联（手动关联 + 关键词自动关联）

### AI 对话与 RAG
- 工作区内 AI 对话，支持流式输出
- RAG 检索：BGE-M3 向量搜索 + PostgreSQL 全文搜索 + RRF 融合
- 引用溯源：AI 回答中引用的卡片可点击跳转
- 沉淀功能：选中 AI 回答内容一键创建卡片
- Web 搜索增强（可选）

### 多模型支持
- 支持 6 种 AI 提供商：DeepSeek、OpenAI、Claude/Anthropic、Gemini、Moonshot、自定义（OpenAI 兼容）
- 对话面板顶部可实时切换模型
- 设置页面管理已配置的提供商和模型列表
- 动态模型列表：自动从 API 拉取可用模型
- 统一 Provider/Registry/Factory 架构，消费者代码零改动

### 话题聚类
- 基于 pgvector 的增量语义聚类
- 网络图上用热力圈可视化话题
- 自适应阈值（基于工作区内卡片相似度分布）
- 支持全量重建

### 话题梳理
- 右键聚类卡片触发"话题梳理"，进入 Typora 风格编辑器
- 左侧源卡片列表，右侧 textarea + Markdown 预览切换
- 4 种 AI 整理模式：自由组织、时间线、论点-论据、对比分类
- SSE 流式输出，实时查看整理进度
- 保存为新卡片，自动关联源卡片（`parent_card_ids`）

### 关联网络图
- D3 力导向图，展示卡片之间的关联关系
- 三种时间轴模式：全部 / 时间 / 事件
- 时间轴播放动画，逐步展示知识积累
- 话题聚类圈叠加显示
- 节点拖拽、缩放、高亮

### 浏览器扩展
- Chrome 扩展，一键保存网页内容为卡片
- AI 自动生成标题和关键词
- 支持 DeepSeek、ChatGPT、Claude 等平台

### 团队协作
- 工作区邀请制，支持 owner / admin / editor / viewer 四级权限
- 活动日志，记录卡片创建、编辑、关联等操作
- 通知系统，支持评论、邀请、活动提醒

## 快速开始

### 环境要求

| 依赖 | 版本 |
|------|------|
| Python | 3.12+ |
| Node.js | 18+ |
| PostgreSQL | 15+（需 pgvector 扩展） |
| uv | 最新版（Python 包管理） |

### 后端

```bash
cd server

# 1. 安装依赖
uv sync

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入至少一个 AI 提供商的 API Key：
#   DEEPSEEK_API_KEY=sk-xxx      (DeepSeek)
#   OPENAI_API_KEY=sk-xxx        (OpenAI)
#   ANTHROPIC_API_KEY=sk-ant-xxx (Claude / Anthropic 兼容)
#   GEMINI_API_KEY=xxx           (Gemini)
#   MOONSHOT_API_KEY=sk-xxx      (Moonshot)
#   CUSTOM_API_KEY=xxx           (自定义 OpenAI 兼容)

# 3. 启动数据库
docker compose up -d   # PostgreSQL（含 pgvector 扩展）

# 4. 数据库迁移
uv run alembic upgrade head

# 5. 启动服务
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API 文档：http://localhost:8000/docs

### Web 端

```bash
cd web

# 1. 安装依赖
npm install

# 2. 启动开发服务器
npm run dev
```

访问 http://localhost:3000

### 小程序

用微信开发者工具打开 `miniapp/` 目录。

### 浏览器扩展

1. Chrome 打开 `chrome://extensions/`，开启开发者模式
2. 加载已解压的扩展程序，选择 `extensions/mindcard-clipper/` 目录
3. 在扩展选项中配置后端地址和 API Key

## 技术栈

| 组件 | 技术 |
|------|------|
| 小程序 | 微信小程序 + Skyline + 云开发 |
| 后端 | FastAPI + SQLAlchemy + PostgreSQL + pgvector |
| 搜索 | BGE-M3 向量搜索 + PostgreSQL 全文搜索 + RRF 融合 |
| AI 提供商 | DeepSeek / OpenAI / Claude / Gemini / Moonshot（httpx 直连，无 SDK 依赖） |
| Web | Next.js 14 + Tailwind CSS + SWR + D3.js |
| Markdown | react-markdown + remark-gfm + remark-math + rehype-katex |
| 浏览器扩展 | Chrome Extension Manifest V3 |

## AI 提供商配置

在 `server/.env` 中配置对应环境变量即可启用：

| 提供商 | 环境变量 | 默认模型 |
|--------|----------|----------|
| DeepSeek | `DEEPSEEK_API_KEY` | deepseek-chat |
| OpenAI | `OPENAI_API_KEY` | gpt-4o |
| Claude / Anthropic | `ANTHROPIC_API_KEY` | claude-sonnet-4-20250514 |
| Gemini | `GEMINI_API_KEY` | gemini-2.5-flash |
| Moonshot | `MOONSHOT_API_KEY` | moonshot-v1-8k |
| 自定义 (OpenAI 兼容) | `CUSTOM_API_KEY` + `CUSTOM_BASE_URL` + `CUSTOM_MODEL` | - |

可选配置：
- `DEFAULT_LLM_PROVIDER` — 默认使用的提供商（默认 deepseek）
- `DEFAULT_LLM_MODEL` — 默认使用的模型（空则使用提供商默认模型）
- 各提供商的 `*_BASE_URL` — 自定义 API 地址（代理 / 私有部署）
