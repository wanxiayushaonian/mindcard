"""Provider registry — declarative metadata for all supported LLM providers."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ProviderSpec:
    name: str
    label: str
    env_key: str
    default_base_url: str
    default_model: str
    models: list[str] = field(default_factory=list)
    backend: str = "openai_compat"  # "openai_compat" | "anthropic"


PROVIDERS: dict[str, ProviderSpec] = {
    "deepseek": ProviderSpec(
        name="deepseek",
        label="DeepSeek",
        env_key="DEEPSEEK_API_KEY",
        default_base_url="https://api.deepseek.com",
        default_model="deepseek-chat",
        models=["deepseek-chat", "deepseek-reasoner"],
        backend="openai_compat",
    ),
    "openai": ProviderSpec(
        name="openai",
        label="OpenAI",
        env_key="OPENAI_API_KEY",
        default_base_url="https://api.openai.com",
        default_model="gpt-4o",
        models=["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
        backend="openai_compat",
    ),
    "claude": ProviderSpec(
        name="claude",
        label="Claude / Anthropic 兼容",
        env_key="ANTHROPIC_API_KEY",
        default_base_url="https://api.anthropic.com",
        default_model="claude-sonnet-4-20250514",
        models=[
            "claude-sonnet-4-20250514",
            "claude-haiku-4-20250414",
            "mimo-v2.5-pro",
            "mimo-v2.5",
        ],
        backend="anthropic",
    ),
    "gemini": ProviderSpec(
        name="gemini",
        label="Gemini",
        env_key="GEMINI_API_KEY",
        default_base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        default_model="gemini-2.5-flash",
        models=["gemini-2.5-flash", "gemini-2.5-pro"],
        backend="openai_compat",
    ),
    "moonshot": ProviderSpec(
        name="moonshot",
        label="Moonshot",
        env_key="MOONSHOT_API_KEY",
        default_base_url="https://api.moonshot.cn",
        default_model="moonshot-v1-8k",
        models=["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
        backend="openai_compat",
    ),
    "custom": ProviderSpec(
        name="custom",
        label="自定义 (OpenAI 兼容)",
        env_key="CUSTOM_API_KEY",
        default_base_url="",
        default_model="",
        models=[],
        backend="openai_compat",
    ),
}
