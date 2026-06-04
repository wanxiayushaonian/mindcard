# 对话分叉系统改进 — 设计规格（v2）

**目标：** 借鉴 Stello 的分叉压缩和跨分支通信设计模式，改进 MindCard 现有的分叉系统。不引入外部依赖，不使用 sidecar。

**技术栈：** 现有 Python FastAPI + PostgreSQL + Next.js

---

## 问题分析

经过深入对比 Stello 和 MindCard，发现：

- **MindCard 已有的能力**：话题漂移检测（embedding 余弦相似度）、拓扑树（PostgreSQL TreeNode）、记忆提取（summarize_chat → 知识卡片）
- **MindCard 缺失的能力**：分叉时的上下文压缩（目前是截断拼接）、跨分支通信（分支间完全隔离）
- **Stello 的真正价值**：不是它的引擎框架，而是两个设计模式 — LLM 上下文压缩和跨分支 insight 机制

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

1. **fork_compress.py** — LLM 压缩服务
2. **chat.py fork_chat** — 改用压缩服务
3. **AiChat 模型** — 添加 system_context 字段
4. **ws.py** — 发送消息时注入 system_context 和 insight
5. **BranchInsight 模型 + API** — 跨分支通信
6. **AiChatPanel** — 移除 forkMode，新增分支按钮 + 分支树 UI
7. **洞察 UI** — 洞察指示器 + 面板
