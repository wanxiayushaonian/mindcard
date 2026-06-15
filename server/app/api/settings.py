"""Settings API — provider listing, switching, and current config."""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User, UserSetting
from app.models.workspace import WorkspaceMember
from app.providers.factory import make_provider
from app.providers.registry import PROVIDERS
from app.services.llm import get_llm_service
from app.utils.auth import get_current_user

router = APIRouter()


# ── Schemas ──


class ProviderInfo(BaseModel):
    name: str
    label: str
    models: list[str]
    default_model: str
    configured: bool  # True if API key is available
    backend: str


class CurrentProviderResponse(BaseModel):
    provider: str
    model: str
    backend: str


class SwitchProviderRequest(BaseModel):
    provider: str
    model: str | None = None


class UpdateExtractionLanguageRequest(BaseModel):
    language: str  # 'zh' | 'en'


class ExtractionProviderResponse(BaseModel):
    provider: str
    model: str
    available_providers: list[str]


class UpdateExtractionProviderRequest(BaseModel):
    provider: str
    model: str | None = None


# ── Helpers ──


async def _require_admin(user: User, db: AsyncSession) -> None:
    """Verify user is an owner of at least one workspace (admin proxy)."""
    from fastapi import HTTPException
    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.role == "owner",
        ).limit(1)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="需要管理员权限")


def _resolve_api_key_for_provider(provider_name: str) -> str:
    """Get the configured API key for a provider from settings."""
    key_map = {
        "deepseek": settings.deepseek_api_key,
        "openai": settings.openai_api_key,
        "claude": settings.anthropic_api_key,
        "gemini": settings.gemini_api_key,
        "moonshot": settings.moonshot_api_key,
        "custom": settings.custom_api_key,
    }
    return key_map.get(provider_name, "") or ""


def _resolve_base_url_for_provider(provider_name: str) -> str | None:
    """Get the configured base URL for a provider."""
    url_map = {
        "deepseek": settings.deepseek_base_url,
        "openai": settings.openai_base_url,
        "claude": settings.anthropic_base_url,
        "custom": settings.custom_base_url or None,
    }
    return url_map.get(provider_name)


def _resolve_model_for_provider(provider_name: str) -> str | None:
    """Get the configured model for a provider."""
    if provider_name == "custom" and settings.custom_model:
        return settings.custom_model
    return None


# ── Endpoints ──


@router.get("/providers", response_model=list[ProviderInfo])
async def list_providers(user: User = Depends(get_current_user)):
    """List all registered providers with their configuration status."""
    result = []
    for name, spec in PROVIDERS.items():
        api_key = _resolve_api_key_for_provider(name)
        result.append(ProviderInfo(
            name=name,
            label=spec.label,
            models=spec.models,
            default_model=spec.default_model,
            configured=bool(api_key),
            backend=spec.backend,
        ))
    return result


@router.get("/current", response_model=CurrentProviderResponse)
async def get_current_provider(user: User = Depends(get_current_user)):
    """Get the currently active provider."""
    provider = get_llm_service().current_provider
    return CurrentProviderResponse(
        provider=get_llm_service()._provider_name,
        model=provider.model,
        backend=type(provider).__name__,
    )


@router.put("/provider")
async def switch_provider(
    req: SwitchProviderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Switch the active LLM provider for the current user."""
    if req.provider not in PROVIDERS:
        raise HTTPException(400, f"Unknown provider: {req.provider}")

    await _require_admin(user, db)

    api_key = _resolve_api_key_for_provider(req.provider)
    if not api_key:
        raise HTTPException(400, f"Provider '{req.provider}' has no API key configured")

    base_url = _resolve_base_url_for_provider(req.provider)
    model = req.model or _resolve_model_for_provider(req.provider)

    get_llm_service().switch_provider(req.provider, api_key, base_url, model)

    # Persist user preference
    result = await db.execute(select(UserSetting).where(UserSetting.user_id == user.id))
    user_setting = result.scalar_one_or_none()
    if user_setting:
        user_setting.ai_provider = req.provider
        await db.commit()

    return {"ok": True, "provider": req.provider, "model": model}


@router.get("/models/{provider_name}")
async def list_models_for_provider(provider_name: str, user: User = Depends(get_current_user)):
    """Dynamically fetch available models from a provider's API.

    Falls back to the static list from the registry if the API call fails
    or the provider doesn't support model listing (e.g. Anthropic).
    """
    if provider_name not in PROVIDERS:
        raise HTTPException(400, f"Unknown provider: {provider_name}")

    spec = PROVIDERS[provider_name]
    api_key = _resolve_api_key_for_provider(provider_name)
    if not api_key:
        return {"models": spec.models, "source": "static"}

    base_url = _resolve_base_url_for_provider(provider_name)
    provider = make_provider(provider_name, api_key, base_url)

    try:
        remote_models = await provider.list_models()
    except Exception:
        remote_models = []

    if remote_models:
        return {"models": remote_models, "source": "remote"}

    return {"models": spec.models, "source": "static"}


@router.put("/extraction-language")
async def update_extraction_language(
    req: UpdateExtractionLanguageRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update the user's extraction language preference for knowledge graph."""
    if req.language not in ["zh", "en"]:
        raise HTTPException(400, "Language must be 'zh' or 'en'")

    result = await db.execute(select(UserSetting).where(UserSetting.user_id == user.id))
    user_setting = result.scalar_one_or_none()

    if not user_setting:
        user_setting = UserSetting(user_id=user.id, extraction_language=req.language)
        db.add(user_setting)
    else:
        user_setting.extraction_language = req.language

    await db.commit()
    return {"ok": True, "language": req.language}


@router.get("/extraction-language")
async def get_extraction_language(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the user's extraction language preference."""
    result = await db.execute(select(UserSetting).where(UserSetting.user_id == user.id))
    user_setting = result.scalar_one_or_none()

    language = user_setting.extraction_language if user_setting else "zh"
    return {"language": language}


@router.get("/extraction-provider", response_model=ExtractionProviderResponse)
async def get_extraction_provider(user: User = Depends(get_current_user)):
    """Get the current extraction LLM provider config."""
    available = []
    for name, spec in PROVIDERS.items():
        api_key = _resolve_api_key_for_provider(name)
        if api_key:
            available.append(name)

    return ExtractionProviderResponse(
        provider=get_llm_service().extraction_provider_name,
        model=get_llm_service().extraction_model_name or "(默认)",
        available_providers=available,
    )


@router.put("/extraction-provider")
async def update_extraction_provider(
    req: UpdateExtractionProviderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Switch the extraction LLM provider (writes to .env)."""
    if req.provider not in PROVIDERS:
        raise HTTPException(400, f"Unknown provider: {req.provider}")

    await _require_admin(user, db)

    api_key = _resolve_api_key_for_provider(req.provider)
    if not api_key:
        raise HTTPException(400, f"Provider '{req.provider}' has no API key configured")

    # Update .env file
    _update_env("EXTRACTION_LLM_PROVIDER", req.provider)
    if req.model:
        _update_env("EXTRACTION_LLM_MODEL", req.model)
    elif req.model == "":
        _update_env("EXTRACTION_LLM_MODEL", "")

    # Update runtime config
    settings.extraction_llm_provider = req.provider
    settings.extraction_llm_model = req.model or ""
    get_llm_service().reset_extraction_provider()

    return {"ok": True, "provider": req.provider, "model": req.model or "(默认)"}


# ── Web Search Settings ──

class WebSearchSettingsResponse(BaseModel):
    provider: str
    api_key_set: bool
    base_url: str
    max_results: int
    timeout: int
    proxy: str
    providers: list[dict]


class UpdateWebSearchSettingsRequest(BaseModel):
    provider: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    max_results: int | None = None
    timeout: int | None = None
    proxy: str | None = None


@router.get("/web-search", response_model=WebSearchSettingsResponse)
async def get_web_search_settings(user: User = Depends(get_current_user)):
    """Get current web search configuration."""
    from app.services.web_search import PROVIDER_META

    return WebSearchSettingsResponse(
        provider=settings.web_search_provider,
        api_key_set=bool(settings.web_search_api_key),
        base_url=settings.web_search_base_url,
        max_results=settings.web_search_max_results,
        timeout=settings.web_search_timeout,
        proxy=settings.web_search_proxy,
        providers=PROVIDER_META,
    )


@router.put("/web-search")
async def update_web_search_settings(
    req: UpdateWebSearchSettingsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update web search configuration."""
    await _require_admin(user, db)
    if req.provider is not None:
        valid_names = {p["name"] for p in [
            {"name": "duckduckgo"}, {"name": "brave"}, {"name": "tavily"},
            {"name": "searxng"}, {"name": "jina"}, {"name": "kagi"},
        ]}
        if req.provider not in valid_names:
            raise HTTPException(400, f"Unknown provider: {req.provider}")
        _update_env("WEB_SEARCH_PROVIDER", req.provider)
        settings.web_search_provider = req.provider

    if req.api_key is not None:
        _update_env("WEB_SEARCH_API_KEY", req.api_key)
        settings.web_search_api_key = req.api_key

    if req.base_url is not None:
        _update_env("WEB_SEARCH_BASE_URL", req.base_url)
        settings.web_search_base_url = req.base_url

    if req.max_results is not None:
        clamped = max(1, min(req.max_results, 10))
        _update_env("WEB_SEARCH_MAX_RESULTS", str(clamped))
        settings.web_search_max_results = clamped

    if req.timeout is not None:
        clamped = max(1, min(req.timeout, 120))
        _update_env("WEB_SEARCH_TIMEOUT", str(clamped))
        settings.web_search_timeout = clamped

    if req.proxy is not None:
        _update_env("WEB_SEARCH_PROXY", req.proxy)
        settings.web_search_proxy = req.proxy

    return {
        "ok": True,
        "provider": settings.web_search_provider,
        "max_results": settings.web_search_max_results,
        "timeout": settings.web_search_timeout,
    }


def _update_env(key: str, value: str) -> None:
    """Update or add a key in the .env file."""
    # Sanitize: strip newlines to prevent env injection
    value = value.replace("\n", "").replace("\r", "")
    env_path = ".env"
    lines: list[str] = []
    found = False

    try:
        with open(env_path) as f:
            for line in f:
                if line.strip().startswith(f"{key}="):
                    lines.append(f"{key}={value}\n")
                    found = True
                else:
                    lines.append(line)
    except FileNotFoundError:
        pass

    if not found:
        lines.append(f"{key}={value}\n")

    with open(env_path, "w") as f:
        f.writelines(lines)


# ── Fork Settings ──


class ForkProfileInfo(BaseModel):
    name: str
    label: str
    description: str


class ForkSettingsResponse(BaseModel):
    auto_fork_enabled: bool
    fork_context_strategy: str
    profiles: list[ForkProfileInfo]


class UpdateForkSettingsRequest(BaseModel):
    auto_fork_enabled: bool | None = None
    fork_context_strategy: str | None = None


@router.get("/fork", response_model=ForkSettingsResponse)
async def get_fork_settings(user: User = Depends(get_current_user)):
    """Get current chat fork configuration."""
    from app.tools.fork_profiles import get_all_profiles
    profiles = [
        ForkProfileInfo(name=p.name, label=p.label, description=p.description)
        for p in get_all_profiles().values()
    ]
    return ForkSettingsResponse(
        auto_fork_enabled=settings.auto_fork_enabled,
        fork_context_strategy=settings.fork_context_strategy,
        profiles=profiles,
    )


@router.put("/fork")
async def update_fork_settings(
    req: UpdateForkSettingsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update chat fork configuration."""
    await _require_admin(user, db)
    valid_strategies = {"none", "inherit", "compress"}

    if req.auto_fork_enabled is not None:
        _update_env("AUTO_FORK_ENABLED", str(req.auto_fork_enabled).lower())
        settings.auto_fork_enabled = req.auto_fork_enabled

    if req.fork_context_strategy is not None:
        if req.fork_context_strategy not in valid_strategies:
            raise HTTPException(
                400,
                f"Invalid strategy: {req.fork_context_strategy}. Must be one of: {valid_strategies}",
            )
        _update_env("FORK_CONTEXT_STRATEGY", req.fork_context_strategy)
        settings.fork_context_strategy = req.fork_context_strategy

    return {"ok": True}
