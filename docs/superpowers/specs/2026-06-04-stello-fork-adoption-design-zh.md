# 对话分叉系统改进 — 设计规格（v2）

**目标：** 借鉴 Stello 的分叉压缩和跨分支通信设计模式，改进 MindCard 现有的分叉系统。不引入外部依赖，不使用 sidecar。

**技术栈：** 现有 Python FastAPI + PostgreSQL + Next.js

---

## 问题分析

经过深入对比 Stello 和 MindCard，发现：

- **MindCard 的漂移检测不够可靠** — 当前使用 embedding 余弦相似度（阈值 0.5），只和上一条消息比较，不理解对话意图，会产生误判
- **分叉上下文压缩质量差** — 截断 200 字 × 最近 20 条拼接，长对话效果很差
- **没有跨分支通信** — 分支间完全隔离
- **Stello 的真正价值**：LLM 判断分叉时机、LLM 上下文压缩、跨分支 insight 机制

## 改进 0：LLM 驱动的分叉检测（替代 embedding 余弦相似度）

### 现状问题

`topic_drift.py` 用余弦相似度比较相邻两条用户消息，阈值 0.5。问题：
- 只看表面语义，不懂意图（"机器学习"和"反向传播"可能相似度低但是同一话题）
- 只和上一条比较，不看对话整体轨迹
- 阈值是拍脑袋的，没有校准
- 自动触发后直接改拓扑树，用户无法审查

### 改进方案：LLM 响应中嵌入分叉信号

**核心思路**：不额外调用 LLM，而是在 LLM 生成回复时让它同时判断是否需要分叉。

**system prompt 追加指令**：
```
话题分叉判断规则：
如果你判断用户的新话题与当前分支的主题明显不同，需要创建新分支，
请在回复的最开头输出标记：[BRANCH: 简短说明新话题]
然后正常回复。

示例：
- 当前分支讨论"RAG 原理"，用户问"向量检索怎么优化" → 不分叉（同一话题）
- 当前分支讨论"RAG 原理"，用户问"怎么做红烧肉" → [BRANCH: 烹饪] 完全不同的话题
- 当前分支讨论"Python 语法"，用户问"机器学习入门" → [BRANCH: 机器学习] 相关但值得独立探索

注意：
- 只在话题真正偏离时才标记，不要过于敏感
- 如果只是当前话题的深入或延伸，不要分叉
- 如果用户明确说"换个话题"或"另一个问题"，考虑分叉
```

**服务端解析**（修改 `ws.py`）：
```python
import re

BRANCH_PATTERN = re.compile(r'^\[BRANCH:\s*(.+?)\]\s*')

async def handle_stream_complete(chat_id, full_response):
    match = BRANCH_PATTERN.match(full_response)
    if match:
        branch_reason = match.group(1)
        clean_response = full_response[match.end():]
        
        # 创建子对话（带 LLM 压缩的父上下文）
        child_chat = await create_fork(chat_id, branch_reason, strategy="compress")
        
        # 发送 auto_fork 事件给前端
        await ws.send_json({
            "type": "auto_fork",
            "node_id": str(child_chat.tree_node_id),
            "title": branch_reason,
            "child_chat_id": str(child_chat.id),
        })
    else:
        clean_response = full_response
    
    # 保存助手消息（不含 [BRANCH: ...] 标记）
    await save_message(chat_id, "assistant", clean_response)
```

**前端处理**：
- 收到 `auto_fork` 事件时，在消息列表中插入分支树节点（替代旧的 fork divider）
- 自动跳转到新分支，或提示用户"检测到话题偏移，已创建新分支"
- 用户可以在设置中关闭自动分叉

### 与 Stello 的对比

| 方面 | Stello | MindCard（改进后） |
|------|--------|-------------------|
| 分叉判断 | LLM 工具调用 | LLM 响应标记 |
| 额外延迟 | 无（工具调用在响应中） | 无（标记在响应中） |
| 解析方式 | 工具调用解析 | 正则匹配 |
| 用户控制 | 无内置控制 | 可设置关闭自动分叉 |

效果相当，实现更简单。

## 改进 1：分叉上下文压缩

### 现状

`chat.py` 的 `fork_chat` 端点（第 463-477 行）截断每条消息 200 字，拼接最近 20 条作为上下文摘要。这对长对话效果很差。

### 改进方案

新增 `server/app/services/fork_compress.py`，使用 LLM 生成结构化摘要：

```python
class ForkCompressor:
    async def compress(
        self,
        messages: list[ChatMessage],
        strategy: str = "compress",  # "none" | "inherit" | "compress"
    ) -> str | None:
        """压缩父对话上下文，生成注入子分支 systemPrompt 的摘要。"""
        if strategy == "none":
            return None
        if strategy == "inherit":
            return self._raw_context(messages)
        # strategy == "compress"
        return await self._llm_compress(messages)

    async def _llm_compress(self, messages: list[ChatMessage]) -> str:
        """调用 LLM 生成结构化摘要。"""
        conversation = self._format_conversation(messages)
        prompt = f"""请将以下对话压缩为结构化摘要，保留关键信息：
1. 主题和核心问题
2. 关键发现和结论
3. 未解决的问题
4. 重要的上下文信息

对话内容：
{conversation}

请用简洁的中文输出摘要。"""
        summary = await llm_service.complete_simple(
            system_prompt="你是一个对话摘要助手。",
            user_content=prompt,
            max_tokens=500,
            temperature=0.3,
        )
        return f"\n\n<parent_context>\n{summary}\n</parent_context>"
```

### 修改 `fork_chat` 端点

```python
@router.post("/{chat_id}/fork")
async def fork_chat(chat_id: str, ...):
    # ... 现有逻辑 ...
    
    # 改进：使用 LLM 压缩替代截断拼接
    from app.services.fork_compress import fork_compressor
    
    parent_messages = await db.execute(
        select(ChatMessage).where(ChatMessage.chat_id == chat_id)
        .order_by(ChatMessage.created_at)
    )
    messages = parent_messages.scalars().all()
    context = await fork_compressor.compress(messages, strategy="compress")
    
    # 注入到子对话的 system prompt
    child_chat.system_context = context
```

### 存储方式

在 `AiChat` 模型中添加 `system_context` 字段（TEXT，可为空），存储压缩后的父上下文。发送消息时，将 `system_context` 注入到 RAG 的 system prompt 中。

```sql
ALTER TABLE ai_chats ADD COLUMN system_context TEXT;
```

## 改进 2：跨分支通信

### 设计

借鉴 Stello 的 `insight` 机制，但简化为数据库模型：

```python
# server/app/models/chat.py
class BranchInsight(Base):
    """跨分支洞察 — 一个分支发现的信息可以传递给兄弟分支。"""
    __tablename__ = "branch_insights"
    
    id = Column(UUID, primary_key=True)
    source_chat_id = Column(UUID, ForeignKey("ai_chats.id"))  # 来源分支
    target_chat_id = Column(UUID, ForeignKey("ai_chats.id"))  # 目标分支
    content = Column(Text, nullable=False)  # 洞察内容
    consumed = Column(Boolean, default=False)  # 是否已被消费
    created_at = Column(DateTime, default=func.now())
```

### 工作流程

1. **自动洞察提取**：每次对话结束时，LLM 检查是否有值得传递给兄弟分支的信息
2. **手动洞察**：用户可以选中一段文字，点击"传递给其他分支"
3. **洞察消费**：当目标分支发送消息时，未消费的 insight 被注入 system prompt，然后标记为已消费

### API 端点

```python
# 创建洞察
POST /api/chats/{chat_id}/insights
Body: { target_chat_id, content }

# 获取未消费的洞察
GET /api/chats/{chat_id}/insights?consumed=false

# 消费洞察（发送消息时自动调用）
POST /api/chats/{chat_id}/insights/consume
```

### system prompt 注入

发送消息时，将未消费的 insight 注入 context：

```python
async def build_system_prompt(chat_id, ...):
    # ... 现有 RAG context ...
    
    # 注入未消费的 insight
    insights = await get_unconsumed_insights(chat_id)
    if insights:
        insight_text = "\n".join(f"- {i.content}" for i in insights)
        context += f"\n\n<cross_branch_insights>\n来自其他分支的发现：\n{insight_text}\n</cross_branch_insights>"
        await mark_insights_consumed(chat_id)
    
    return context
```

## 改进 3：内联分叉清理

### 现状问题

当前存在两种分叉模型共存的混乱：
- 内联分叉分隔符（`role="fork-divider"`，视觉分隔）
- 子对话（`parent_chat_id`，真正的分支）

### 改进方案

**统一为子对话模型**：新对话的分叉全部创建子对话，不再使用内联分叉分隔符。

- 移除 `forkMode` 切换按钮
- 分叉触发方式：输入框中点击 "分支" 按钮（替代原来的 GitBranch 按钮）
- 点击后：创建子对话，跳转到子对话，保留父上下文（通过压缩）
- 旧对话中的内联分叉分隔符保留不变（向后兼容）

## 前端变更

### AiChatPanel

1. **移除 forkMode 状态和切换按钮**
2. **新增"分支"按钮**：在输入框旁，点击后创建子对话并跳转
3. **分支树 UI**：替换面包屑导航为内联水平树
   ```
   ── "探索RAG原理" ──┬── "向量检索细节"（当前）
                     └── "图谱增强方案"
   ```
4. **洞察指示器**：分支树上显示未读洞察数量徽章
5. **洞察面板**：点击徽章展开下拉列表，显示来自其他分支的洞察

### 对话历史面板

- 旧对话：保持现有渲染
- 新对话（有子对话）：显示树形结构，子对话缩进显示

## 数据库迁移

```sql
-- 1. 添加 system_context 字段
ALTER TABLE ai_chats ADD COLUMN system_context TEXT;

-- 2. 创建 branch_insights 表
CREATE TABLE branch_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_chat_id UUID NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
    target_chat_id UUID NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    consumed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_branch_insights_target ON branch_insights(target_chat_id, consumed);
```

## 配置

```env
# 分叉压缩策略
FORK_CONTEXT_STRATEGY=compress  # none | inherit | compress
```

## 实现顺序

1. **LLM 分叉标记** — 修改 system prompt，解析 `[BRANCH: ...]` 标记，替代 `topic_drift.py`
2. **fork_compress.py** — LLM 压缩服务
3. **chat.py fork_chat** — 改用压缩服务，支持 LLM 触发的自动分叉
4. **AiChat 模型** — 添加 system_context 字段
5. **ws.py** — 流式完成时解析分叉标记 + 注入 system_context
6. **BranchInsight 模型 + API** — 跨分支通信
7. **AiChatPanel** — 移除 forkMode，新增分支按钮 + 分支树 UI + 自动分叉提示
8. **洞察 UI** — 洞察指示器 + 面板
9. **设置** — 自动分叉开关
