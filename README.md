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

### 话题聚类
- 基于 pgvector 的增量语义聚类
- 网络图上用热力圈可视化话题
- 自适应阈值（基于工作区内卡片相似度分布）
- 支持全量重建

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
```bash
cd web
npm install
npm run dev
```
访问 http://localhost:3000

### 浏览器扩展
1. 打开 `extensions/mindcard-clipper/manifest.chrome.json`，确认配置
2. Chrome 打开 `chrome://extensions/`，开启开发者模式
3. 加载已解压的扩展程序，选择 `extensions/mindcard-clipper/` 目录

## 技术栈

| 组件 | 技术 |
|------|------|
| 小程序 | 微信小程序 + Skyline + 云开发 |
| 后端 | FastAPI + SQLAlchemy + PostgreSQL + pgvector |
| 搜索 | BGE-M3 向量搜索 + PostgreSQL 全文搜索 + RRF 融合 |
| RAG | DeepSeek API |
| Web | Next.js 14 + Tailwind CSS + SWR + D3.js |
| Markdown | react-markdown + remark-gfm + remark-math + rehype-katex |
| 浏览器扩展 | Chrome Extension Manifest V3 |
