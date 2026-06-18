# Workspace Memory

工作区记忆是 AI 的持久化知识存储，让 AI 能够跨对话积累和检索对工作区的理解。

## 设计理念

传统 AI 对话是无状态的 — 每次对话从零开始。Workspace Memory 让 AI 能够：
- 记住用户的偏好和工作方式
- 积累对工作区内容的理解
- 在后续对话中引用已有的认知

## 数据模型

`WorkspaceMemory` 结构化字段：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `slug` | String(100) | — | 唯一标识（工作区内唯一） |
| `title` | String(200) | — | 记忆标题 |
| `body` | Text | — | 记忆内容（Markdown） |
| `memory_type` | String(20) | `"fact"` | 类型：fact / preference / insight / summary |
| `confidence` | Float | `1.0` | 置信度（0.0-1.0） |
| `importance` | Float | `0.5` | 重要性（0.0-1.0） |
| `source_card_ids` | UUID[] | `[]` | 来源卡片 |
| `source_chat_id` | UUID | null | 来源对话 |
| `embedding` | Vector | null | 语义嵌入 |
| `last_accessed_at` | DateTime | null | 最后访问时间 |

### 记忆类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `fact` | 客观事实 | "用户的研究方向是 Flow Matching" |
| `preference` | 用户偏好 | "用户偏好使用 Python 3.12" |
| `insight` | 洞察/结论 | "Transformer 在长序列上表现更好" |
| `summary` | 摘要 | "上周讨论的主要结论是..." |

## RAG 集成

在每次 AI 对话中，记忆被注入 system prompt：

1. 按 `importance` 降序排列
2. 只注入 `importance ≥ 0.3` 的记忆
3. 每条记忆标注类型标签：`[事实]` / `[偏好]` / `[洞察]` / `[摘要]`
4. 更新 `last_accessed_at`（fire-and-forget）

注入格式：
```xml
<shared_memory>
## [事实] 用户研究方向
用户目前的研究方向是 Flow Matching 和 HDR...

## [偏好] 代码风格
用户偏好使用 dataclass，不喜欢可变默认参数...
</shared_memory>
```

## memory_edit 工具

AI 可以通过 `memory_edit` 工具在对话中自主管理记忆：

- **upsert**：创建或更新记忆（按 slug 唯一）
- **delete**：删除记忆

工具当前写入 `slug`、`title`、`body`，结构化字段通过 API 设置。

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/{workspace_id}/memories` | 列出所有记忆 |
| POST | `/{workspace_id}/memories` | 创建/更新记忆（upsert by slug） |
| PATCH | `/{workspace_id}/memories/{slug}` | 部分更新记忆 |
| DELETE | `/{workspace_id}/memories/{slug}` | 删除记忆 |

## 前端

MemoryPanel 组件：
- 每条记忆显示类型标签（彩色 badge）
- 类型筛选栏（全部 / 事实 / 偏好 / 洞察 / 摘要）
- 创建表单包含类型选择和重要性滑块
- 支持展开查看完整内容和来源链接

## 相关文件

| 文件 | 职责 |
|------|------|
| `server/app/models/workspace_memory.py` | 数据模型 |
| `server/app/schemas/workspace_memory.py` | Pydantic schema（Create/Update/Response） |
| `server/app/api/memories.py` | API 端点 |
| `server/app/tools/memory_edit.py` | LLM 工具定义 |
| `server/app/services/rag.py` | RAG 注入逻辑（build_branch_context） |
| `web/components/MemoryPanel.tsx` | 前端记忆面板 |
