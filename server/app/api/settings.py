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
from app.providers.factory import make_provider
from app.providers.registry import PROVIDERS
from app.services.llm import llm_service
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


# ── Helpers ──


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
async def list_providers():
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
async def get_current_provider():
    """Get the currently active provider."""
    provider = llm_service.current_provider
    return CurrentProviderResponse(
        provider=llm_service._provider_name,
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

    api_key = _resolve_api_key_for_provider(req.provider)
    if not api_key:
        raise HTTPException(400, f"Provider '{req.provider}' has no API key configured")

    base_url = _resolve_base_url_for_provider(req.provider)
    model = req.model or _resolve_model_for_provider(req.provider)

    llm_service.switch_provider(req.provider, api_key, base_url, model)

    # Persist user preference
    result = await db.execute(select(UserSetting).where(UserSetting.user_id == user.id))
    user_setting = result.scalar_one_or_none()
    if user_setting:
        user_setting.ai_provider = req.provider
        await db.commit()

    return {"ok": True, "provider": req.provider, "model": model}


@router.get("/models/{provider_name}")
async def list_models_for_provider(provider_name: str):
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
