# Tests

本目录包含 MindCard 后端的全部测试用例。运行命令：

```bash
cd server
uv run pytest tests/ -v            # 全部测试
uv run pytest tests/api/ -v        # 仅 API 集成测试
uv run pytest tests/ -v -m "not integration"  # 跳过需要外部服务的测试
```

## 目录结构

```
tests/
├── conftest.py                      # 全局 fixtures（mock DB、模型工厂函数）
├── api/                             # API 路由层集成测试
│   ├── conftest.py                  # API 测试 fixtures（httpx AsyncClient、依赖注入覆盖）
│   ├── test_cards.py
│   ├── test_chat.py
│   ├── test_topology.py
│   └── test_workspaces.py
├── test_auto_bind_benchmark.py
├── test_branch_insight.py
├── test_chat_fork.py
├── test_drift_benchmark.py
├── test_embedding.py
├── test_entity_linker.py
├── test_fork_compress.py
├── test_llm.py
├── test_retrieval_dispatcher.py
├── test_search.py
├── test_split_guard.py
├── test_topic.py
├── test_triple_extractor.py
└── test_workspace_memory.py
```

## API 集成测试 (`api/`)

使用 `httpx.AsyncClient` + FastAPI `dependency_overrides` 模式，模拟 HTTP 请求验证端点行为。通过覆盖 `get_db` 和 `get_current_user` 注入 mock 会话和测试用户。

| 文件 | 测试数 | 覆盖端点 |
|------|--------|----------|
| `test_cards.py` | 13 | `POST/GET/PUT/DELETE /api/cards/`、删除预览、关联管理 |
| `test_chat.py` | 16 | `POST/GET/DELETE /api/chats/`、消息、批量替换、分叉、路径、总结 |
| `test_topology.py` | 14 | `GET/POST/PUT/DELETE /api/topology/`、节点卡片关联、跨分支引用 |
| `test_workspaces.py` | 10 | `POST/GET/PUT/DELETE /api/workspaces/`、成员列表、邀请码 |

## 服务层单元测试

直接调用服务函数，mock 数据库会话，验证业务逻辑正确性。

### 卡片与搜索

| 文件 | 测试数 | 说明 |
|------|--------|------|
| `test_search.py` | 4 | `SearchService` 混合搜索（向量 + 全文）、RRF 融合排序、工作区过滤 |
| `test_embedding.py` | 14 | `EmbeddingService` 文本向量化、批量处理、错误重试、维度校验 |

### AI 对话与 RAG

| 文件 | 测试数 | 说明 |
|------|--------|------|
| `test_llm.py` | 9 | `LLMService` 多 provider 调用、流式响应、错误处理、provider 切换 |
| `test_retrieval_dispatcher.py` | 35 | `RetrievalDispatcher` 四级检索深度路由（FREE/CARD/GRAPH/FULL）、查询分析、上下文组装 |
| `test_chat_fork.py` | 7 | 对话分叉流程：创建子对话、复制消息、上下文摘要注入 |

### 知识图谱三元组提取

| 文件 | 测试数 | 说明 |
|------|--------|------|
| `test_triple_extractor.py` | 20 | `TripleExtractor` NER 实体抽取、RE 关系抽取、JSON 解析、截断修复、bullet-point 降级解析 |
| `test_entity_linker.py` | 8 | `EntityLinker` 实体消歧、创建/复用实体、三元组关联、名称截断保护 |

### 拓扑与主题

| 文件 | 测试数 | 说明 |
|------|--------|------|
| `test_topic.py` | 17 | `TopicService` 纯函数：余弦相似度、聚类、主题词提取、漂移检测 |
| `test_split_guard.py` | 6 | `SplitGuard` 分叉频率限制、重复标签检测、冷却窗口 |
| `test_fork_compress.py` | 4 | `ForkCompressor` 上下文压缩：摘要生成、token 截断 |
| `test_branch_insight.py` | 10 | `BranchInsight` 模型/Schema/API：分支洞察生成、存储、查询 |

### 工作区

| 文件 | 测试数 | 说明 |
|------|--------|------|
| `test_workspace_memory.py` | 7 | 工作区记忆模型验证、Schema 序列化、API 端点 |

## 基准测试 (Benchmark)

需要运行 Ollama 服务（bge-m3 模型），用 `pytest -m "not integration"` 跳过。

| 文件 | 测试数 | 说明 |
|------|--------|------|
| `test_auto_bind_benchmark.py` | 3 | 自动绑定对话到拓扑节点的准确率基准 |
| `test_drift_benchmark.py` | 10 | 主题漂移检测准确率基准 |

## Fixtures 说明

### `tests/conftest.py` — 全局

- `make_workspace()` / `make_chat()` / `make_card()` / `make_tree_node()` — 创建 mock 模型对象
- `mock_db` — AsyncMock 数据库会话

### `tests/api/conftest.py` — API 测试

- `client` — `httpx.AsyncClient`，自动覆盖 `get_db` 和 `get_current_user`
- `test_user` / `test_workspace` / `test_membership` — 预置 mock 对象
- `mock_execute_result()` — 构建 mock 查询结果（支持 `scalar_one`、`scalar_val`、列表三种模式）

## 测试统计

- **总计**: 207 个测试用例
- **API 集成测试**: 53 个
- **服务层单元测试**: 141 个
- **基准测试**: 13 个（需外部服务）
