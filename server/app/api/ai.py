"""AI utility endpoints: polish, supplement, generate-title, extract-keywords."""

import json
import re

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.config import settings
from app.models.user import User
from app.utils.auth import get_current_user

router = APIRouter()


class TextRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)


class TitleResponse(BaseModel):
    title: str


class KeywordsResponse(BaseModel):
    keywords: list[str]


class TextResponse(BaseModel):
    text: str


async def _call_llm(prompt: str, user_content: str, max_tokens: int = 256) -> str:
    """Call DeepSeek API for a simple completion."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{settings.deepseek_base_url}/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
            json={
                "model": "deepseek-chat",
                "messages": [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": user_content},
                ],
                "max_tokens": max_tokens,
                "temperature": 0.5,
            },
        )
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()


@router.post("/polish", response_model=TextResponse)
async def polish_text(req: TextRequest, user: User = Depends(get_current_user)):
    """润色文字，保持原意，优化表达。"""
    result = await _call_llm(
        "你是一个文字润色专家。请润色以下灵感文字，保持原意不变，优化语言表达和逻辑结构。直接输出润色后的文字，不要加任何前缀说明或解释。",
        req.content,
    )
    return TextResponse(text=result)


@router.post("/supplement", response_model=TextResponse)
async def supplement_text(req: TextRequest, user: User = Depends(get_current_user)):
    """拓展灵感内容，补充思路。"""
    result = await _call_llm(
        "你是一个灵感拓展助手。基于用户的灵感内容，从多个角度补充拓展思路。直接输出补充内容，格式清晰有条理。",
        req.content,
    )
    return TextResponse(text=result)


@router.post("/generate-title", response_model=TitleResponse)
async def generate_title(req: TextRequest, user: User = Depends(get_current_user)):
    """生成简短标题。"""
    raw = await _call_llm(
        "请用不超过20个字概括以下内容的主题，作为标题。只输出标题文字本身，绝对不要加引号、书名号、序号或其他任何符号。",
        req.content,
        max_tokens=32,
    )
    title = re.sub(r'["""\'\'《》【】「」]', '', raw.strip())
    if len(title) > 30:
        title = title[:30]
    return TitleResponse(title=title)


@router.post("/extract-keywords", response_model=KeywordsResponse)
async def extract_keywords(req: TextRequest, user: User = Depends(get_current_user)):
    """提取关键词。"""
    raw = await _call_llm(
        "从以下内容中提取3-5个核心关键字。每个关键字2-4个字，用逗号分隔，不要加序号、解释或其他符号。",
        req.content,
        max_tokens=48,
    )
    keywords = []
    for kw in raw.split(","):
        kw = re.sub(r'["""\'\'《》【】「」]', '', kw.strip())
        if len(kw) > 6:
            kw = kw[:6]
        if kw:
            keywords.append(kw)
    return KeywordsResponse(keywords=keywords[:5])
