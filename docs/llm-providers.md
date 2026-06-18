# LLM Providers

MindCard 使用 Provider Registry 模式统一管理多个 LLM 提供商，实现零消费者代码切换。

## 架构

```
消费者代码（RAG、提取、综合...）
  ↓
make_provider(name) → LLMProvider
  ↓
┌─────────────────────────────────────────────┐
│           Provider Registry                  │
├──────────┬──────────┬──────────┬─────────────┤
│ DeepSeek │  OpenAI  │  Claude  │  Gemini     │
│ Moonshot │  Custom  │          │             │
└──────────┴──────────┴──────────┴─────────────┘
  ↓
raw httpx HTTP 请求（无 SDK 依赖）
```

### 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| `ProviderSpec` | `providers/registry.py` | 冻结数据类，定义提供商规格 |
| `PROVIDERS` | `providers/registry.py` | 提供商名称 → Spec 映射 |
| `LLMProvider` | `providers/base.py` | 抽象基类，定义统一接口 |
| `make_provider()` | `providers/factory.py` | 工厂函数，解析名称 → 具体实现 |
| `OpenAICompatProvider` | `providers/openai_compat.py` | OpenAI 兼容提供商（DeepSeek/OpenAI/Gemini/Moonshot/Custom） |
| `AnthropicProvider` | `providers/anthropic.py` | Anthropic 专用实现 |

## 支持的提供商

| 提供商 | 环境变量 | 默认模型 | 兼容模式 |
|--------|---------|---------|---------|
| DeepSeek | `DEEPSEEK_API_KEY` | deepseek-chat | OpenAI 兼容 |
| OpenAI | `OPENAI_API_KEY` | gpt-4o | OpenAI 兼容 |
| Claude | `ANTHROPIC_API_KEY` | claude-sonnet-4-20250514 | Anthropic 专用 |
| Gemini | `GEMINI_API_KEY` | gemini-2.5-flash | OpenAI 兼容 |
| Moonshot | `MOONSHOT_API_KEY` | moonshot-v1-8k | OpenAI 兼容 |
| Custom | `CUSTOM_API_KEY` + `CUSTOM_BASE_URL` + `CUSTOM_MODEL` | — | OpenAI 兼容 |

## 设计原则

### 零 SDK 依赖

所有提供商使用 raw `httpx` 调用，不依赖任何提供商 SDK。好处：
- 无版本冲突
- 完全控制请求/响应格式
- 统一的重试和错误处理

### 指数退避重试

对 429（速率限制）和 5xx（服务端错误）自动重试，指数退避。

### 流式输出

所有提供商支持 SSE 流式输出，统一的 `stream()` 接口。

### 动态模型列表

`list_models()` 从提供商 API 动态获取可用模型列表，前端实时展示。

## 配置

`server/.env` 中配置：

```bash
# 至少配置一个提供商
DEEPSEEK_API_KEY=sk-xxx

# 可选：默认提供商和模型
DEFAULT_LLM_PROVIDER=deepseek
DEFAULT_LLM_MODEL=

# 可选：自定义端点（代理/自托管）
DEEPSEEK_BASE_URL=https://api.deepseek.com
OPENAI_BASE_URL=https://api.openai.com

# 三元组提取专用配置
EXTRACTION_PROVIDER=deepseek
EXTRACTION_LANGUAGE=zh
```

## 添加新提供商

### OpenAI 兼容提供商

只需在 `registry.py` 的 `PROVIDERS` 字典中添加一个 `ProviderSpec` 条目：

```python
PROVIDERS["new_provider"] = ProviderSpec(
    name="new_provider",
    env_key="NEW_PROVIDER_API_KEY",
    base_url="https://api.new-provider.com/v1",
    default_model="model-name",
    compat="openai",
)
```

### 非 OpenAI 兼容提供商

需要：
1. 在 `registry.py` 添加 `ProviderSpec`（`compat="custom"`）
2. 在 `providers/` 下新建实现类，继承 `LLMProvider`
3. 在 `factory.py` 的 `make_provider()` 中添加路由

## 前端集成

- **模型选择器**：`ModelSelector` 组件，实时展示可用模型
- **API Key 管理**：设置页面，per-user API key 存储
- **提取配置**：独立的提取提供商和语言设置

## 相关文件

| 文件 | 职责 |
|------|------|
| `server/app/providers/registry.py` | ProviderSpec + PROVIDERS 注册表 |
| `server/app/providers/factory.py` | make_provider() 工厂函数 |
| `server/app/providers/base.py` | LLMProvider 抽象基类 |
| `server/app/providers/openai_compat.py` | OpenAI 兼容实现 |
| `server/app/providers/anthropic.py` | Anthropic 实现 |
| `server/app/services/llm.py` | LLM 服务（消费者入口） |
| `web/components/ModelSelector.tsx` | 前端模型选择器 |
