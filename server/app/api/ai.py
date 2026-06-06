"""AI utility endpoints: polish, supplement, generate-title, extract-keywords."""

import json
import logging
import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.models.user import User
from app.services.llm import llm_service
from app.utils.auth import get_current_user
from app.utils.rate_limit import ai_rate_limit

router = APIRouter()
logger = logging.getLogger(__name__)


class TextRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)


class TitleResponse(BaseModel):
    title: str


class KeywordsResponse(BaseModel):
    keywords: list[str]


class TextResponse(BaseModel):
    text: str


class Segment(BaseModel):
    title: str
    content: str


class SegmentResponse(BaseModel):
    segments: list[Segment]


@router.post("/polish", response_model=TextResponse)
async def polish_text(req: TextRequest, user: User = Depends(get_current_user), _: None = Depends(ai_rate_limit)):
    """润色文字，保持原意，优化表达。"""
    result = await llm_service.complete_simple(
        "你是一个文字润色专家。请润色以下灵感文字，保持原意不变，优化语言表达和逻辑结构。直接输出润色后的文字，不要加任何前缀说明或解释。",
        req.content,
    )
    return TextResponse(text=result)


@router.post("/supplement", response_model=TextResponse)
async def supplement_text(req: TextRequest, user: User = Depends(get_current_user), _: None = Depends(ai_rate_limit)):
    """拓展灵感内容，补充思路。"""
    result = await llm_service.complete_simple(
        "你是一个灵感拓展助手。基于用户的灵感内容，从多个角度补充拓展思路。直接输出补充内容，格式清晰有条理。",
        req.content,
    )
    return TextResponse(text=result)


@router.post("/generate-title", response_model=TitleResponse)
async def generate_title(req: TextRequest, user: User = Depends(get_current_user), _: None = Depends(ai_rate_limit)):
    """生成简短标题。"""
    provider_name = llm_service.extraction_provider_name
    model_name = llm_service.extraction_model_name or "(默认)"
    logger.info("generate-title: provider=%s, model=%s, content_len=%d", provider_name, model_name, len(req.content))

    raw = await llm_service.extraction_complete_simple(
        "请用不超过20个字概括以下内容的主题，作为标题。只输出标题文字本身，绝对不要加引号、书名号、序号或其他任何符号。",
        req.content,
        max_tokens=64,
    )

    title = re.sub(r'["""\'\'《》【】「」]', '', raw.strip())
    if len(title) > 30:
        title = title[:30]

    # Fallback: use first meaningful line if LLM returned empty
    if not title:
        first_line = next((l.strip() for l in req.content.split('\n') if l.strip()), "")
        title = re.sub(r'^#+\s*', '', first_line)[:30] or "未命名"
        logger.warning("generate-title: LLM returned empty, fallback to %r", title)

    logger.info("generate-title: raw=%r, final=%r", raw, title)
    return TitleResponse(title=title)


@router.post("/extract-keywords", response_model=KeywordsResponse)
async def extract_keywords(req: TextRequest, user: User = Depends(get_current_user), _: None = Depends(ai_rate_limit)):
    """提取关键词。"""
    provider_name = llm_service.extraction_provider_name
    model_name = llm_service.extraction_model_name or "(默认)"
    logger.info("extract-keywords: provider=%s, model=%s, content_len=%d", provider_name, model_name, len(req.content))

    raw = await llm_service.extraction_complete_simple(
        "从以下内容中提取3-5个核心关键字。每个关键字2-6个字，用逗号分隔，不要加序号、解释或其他符号。",
        req.content,
        max_tokens=128,
    )

    logger.info("extract-keywords: raw=%r", raw)
    keywords = []
    for kw in re.split(r'[,，、]', raw):
        kw = re.sub(r'["""\'\'《》【】「」\s]', '', kw.strip())
        if len(kw) > 10:
            kw = kw[:10]
        if kw:
            keywords.append(kw)

    # Fallback: extract words from title/content if LLM returned empty
    if not keywords:
        words = re.findall(r'[一-鿿]{2,6}|[a-zA-Z]{3,}', req.content[:500])
        keywords = list(dict.fromkeys(words))[:5]
        logger.warning("extract-keywords: LLM returned empty, fallback to %d keywords", len(keywords))

    return KeywordsResponse(keywords=keywords[:5])


@router.post("/segment-content", response_model=SegmentResponse)
async def segment_content(req: TextRequest, user: User = Depends(get_current_user), _: None = Depends(ai_rate_limit)):
    """将 AI 输出智能分段为多个独立内容块。"""
    raw = await llm_service.complete_simple(
        "你是一个内容分析助手。请将以下内容按逻辑主题分段。每段需要有一个简短标题（不超过10字）和对应的正文内容。"
        "输出严格的 JSON 数组格式：[{\"title\": \"段落标题\", \"content\": \"段落内容\"}]。"
        "分段原则：每个独立观点、主题或建议作为一段；表格数据作为一段；列表中的每个大项可作为独立段落。"
        "只输出 JSON 数组，不要加任何其他文字或代码块标记。",
        req.content,
        max_tokens=4096,
    )

    # Parse JSON from response
    json_str = raw.strip()
    fence_match = re.search(r"```(?:json)?\s*\n?(.*?)```", json_str, re.DOTALL | re.IGNORECASE)
    if fence_match:
        json_str = fence_match.group(1).strip()

    try:
        data = json.loads(json_str)
        if isinstance(data, list):
            segments = []
            for item in data:
                if isinstance(item, dict) and "content" in item:
                    segments.append(Segment(
                        title=str(item.get("title", ""))[:30],
                        content=str(item["content"]),
                    ))
            if segments:
                return SegmentResponse(segments=segments)
    except (json.JSONDecodeError, KeyError, TypeError):
        pass

    # Fallback: return the whole content as one segment
    return SegmentResponse(segments=[Segment(title="整体内容", content=req.content)])
