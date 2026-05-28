"""Provider factory — resolves a provider name into a concrete LLMProvider instance."""

from __future__ import annotations

from app.providers.base import LLMProvider
from app.providers.registry import PROVIDERS


def make_provider(
    provider_name: str,
    api_key: str,
    base_url: str | None = None,
    model: str | None = None,
) -> LLMProvider:
    """Create an LLMProvider for the given provider name.

    Args:
        provider_name: Key in PROVIDERS registry (e.g. "deepseek", "openai").
        api_key: API key for the provider.
        base_url: Override base URL. If None, uses the provider's default.
        model: Override model name. If None, uses the provider's default.

    Returns:
        Configured LLMProvider instance.

    Raises:
        ValueError: If provider_name is not in the registry.
    """
    if provider_name not in PROVIDERS:
        raise ValueError(f"Unknown provider: {provider_name}. Available: {list(PROVIDERS.keys())}")

    spec = PROVIDERS[provider_name]
    resolved_url = base_url or spec.default_base_url
    resolved_model = model or spec.default_model

    if spec.backend == "anthropic":
        from app.providers.anthropic import AnthropicProvider

        return AnthropicProvider(api_key=api_key, base_url=resolved_url, model=resolved_model)

    # Default: openai_compat
    from app.providers.openai_compat import OpenAICompatProvider

    return OpenAICompatProvider(api_key=api_key, base_url=resolved_url, model=resolved_model)
