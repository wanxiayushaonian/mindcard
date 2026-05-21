import json
import logging
import uuid
from collections.abc import AsyncGenerator

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.card import Card
from app.schemas.rag import CardSummary
from app.services.embedding import embedding_service
from app.services.search import search_service

logger = logging.getLogger(__name__)


class RAGService:
    """RAG pipeline: retrieve relevant cards → build context → LLM answer."""

    async def ask(
        self,
        db: AsyncSession,
        question: str,
        workspace_id: str,
        card_id: str | None = None,
        top_k: int = 5,
    ) -> dict:
        """Answer a question using RAG over workspace cards."""
        # 1. Retrieve relevant cards
        if card_id:
            context_cards = await self._find_similar_cards(db, card_id, limit=top_k)
        else:
            scored = await search_service.hybrid_search(db, question, workspace_id, limit=top_k)
            context_cards = [sc.card for sc in scored]

        if not context_cards:
            return {
                "answer": "No relevant cards found for your question.",
                "source_cards": [],
                "confidence": 0.0,
            }

        # 2. Build context
        context = "\n\n".join(
            f"【{c.title or 'Untitled'}】{c.content}" for c in context_cards
        )
        prompt = f"""Based on the following inspiration cards, answer the user's question.
If the card content is insufficient to answer, say so.

Relevant inspiration cards:
{context}

User question: {question}"""

        # 3. Call LLM
        answer = await self._call_llm(prompt)

        # 4. Return with sources
        source_cards = [
            CardSummary(
                id=str(c.id),
                title=c.title,
                content=c.content[:200],
                keywords=c.keywords,
            )
            for c in context_cards
        ]
        return {
            "answer": answer,
            "source_cards": source_cards,
            "confidence": 0.8 if context_cards else 0.0,
        }

    async def find_similar(
        self, db: AsyncSession, card_id: str, limit: int = 5, exclude_ids: list[str] | None = None
    ) -> list[Card]:
        """Find similar cards using vector cosine distance (replaces agent.js)."""
        return await self._find_similar_cards(db, card_id, limit, exclude_ids=exclude_ids)

    async def generate_insights(self, db: AsyncSession, workspace_id: str) -> dict:
        """Analyze workspace inspiration patterns."""
        ws_uuid = uuid.UUID(workspace_id)
        result = await db.execute(
            select(Card).where(Card.workspace_id == ws_uuid).limit(100)
        )
        cards = result.scalars().all()

        if not cards:
            return {"themes": [], "trends": "", "unexplored": [], "suggestions": []}

        cards_text = "\n".join(
            f"- [{c.title or 'No title'}] {c.content[:100]}" for c in cards
        )
        prompt = f"""Analyze the following {len(cards)} inspiration cards and provide:
1. Main thinking themes (3-5)
2. Thinking evolution trends
3. Potentially unexplored directions
4. Suggestions for further development

Inspiration cards:
{cards_text}

Respond in JSON format:
{{"themes": [...], "trends": "...", "unexplored": [...], "suggestions": [...]}}"""

        answer = await self._call_llm(prompt)

        # Parse JSON from answer
        import json

        try:
            # Extract JSON from response (may be wrapped in markdown code block)
            json_str = answer
            if "```json" in answer:
                json_str = answer.split("```json")[1].split("```")[0]
            elif "```" in answer:
                json_str = answer.split("```")[1].split("```")[0]
            data = json.loads(json_str.strip())
            # Normalize types: LLM may return trends as a list instead of string
            if isinstance(data.get("trends"), list):
                data["trends"] = "\n".join(data["trends"])
            return data
        except (json.JSONDecodeError, IndexError):
            return {
                "themes": [],
                "trends": answer,
                "unexplored": [],
                "suggestions": [],
            }

    async def _find_similar_cards(
        self, db: AsyncSession, card_id: str, limit: int = 5, exclude_ids: list[str] | None = None
    ) -> list[Card]:
        card = await db.get(Card, uuid.UUID(card_id))
        if not card:
            return []

        exclude = {uuid.UUID(card_id)}
        if exclude_ids:
            exclude.update(uuid.UUID(rid) for rid in exclude_ids)

        if card.embedding is None:
            # Fallback: return recent cards from the same workspace
            result = await db.execute(
                select(Card)
                .where(Card.workspace_id == card.workspace_id)
                .where(Card.id.notin_(exclude))
                .order_by(Card.created_at.desc())
                .limit(limit)
            )
            return result.scalars().all()

        result = await db.execute(
            select(Card)
            .where(Card.workspace_id == card.workspace_id)
            .where(Card.id.notin_(exclude))
            .order_by(Card.embedding.cosine_distance(card.embedding))
            .limit(limit)
        )
        return result.scalars().all()

    async def chat(
        self, message: str, history: list[dict[str, str]] | None = None
    ) -> str:
        """General chat without RAG, supports conversation history."""
        if not settings.deepseek_api_key:
            return "LLM API key not configured. Please set DEEPSEEK_API_KEY."

        messages = [{"role": "system", "content": "你是一个 helpful AI 助手，可以回答各种问题。"}]
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": message})

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{settings.deepseek_base_url}/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
                json={
                    "model": "deepseek-chat",
                    "messages": messages,
                    "max_tokens": 2048,
                    "temperature": 0.7,
                },
            )
            data = resp.json()
            return data["choices"][0]["message"]["content"]

    async def chat_stream(
        self, message: str, history: list[dict[str, str]] | None = None
    ) -> AsyncGenerator[str, None]:
        """Streaming general chat without RAG."""
        if not settings.deepseek_api_key:
            yield "LLM API key not configured."
            return

        messages = [{"role": "system", "content": "你是一个 helpful AI 助手，可以回答各种问题。"}]
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": message})

        async for chunk in self._call_llm_stream(messages):
            yield chunk

    async def ask_stream(
        self,
        db: AsyncSession,
        question: str,
        workspace_id: str,
        card_id: str | None = None,
        top_k: int = 5,
    ) -> AsyncGenerator[str, None]:
        """Streaming RAG answer: retrieve cards, then stream LLM response."""
        # 1. Retrieve relevant cards
        if card_id:
            context_cards = await self._find_similar_cards(db, card_id, limit=top_k)
        else:
            scored = await search_service.hybrid_search(db, question, workspace_id, limit=top_k)
            context_cards = [sc.card for sc in scored]

        if not context_cards:
            yield "没有找到相关的灵感卡片。"
            return

        # 2. Build context
        context = "\n\n".join(
            f"【{c.title or 'Untitled'}】{c.content}" for c in context_cards
        )
        prompt = f"""Based on the following inspiration cards, answer the user's question.
If the card content is insufficient to answer, say so.

Relevant inspiration cards:
{context}

User question: {question}"""

        # 3. Stream LLM response
        messages = [{"role": "user", "content": prompt}]
        async for chunk in self._call_llm_stream(messages):
            yield chunk

    async def _call_llm_stream(
        self, messages: list[dict[str, str]]
    ) -> AsyncGenerator[str, None]:
        """Stream response from DeepSeek API."""
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            async with client.stream(
                "POST",
                f"{settings.deepseek_base_url}/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
                json={
                    "model": "deepseek-chat",
                    "messages": messages,
                    "max_tokens": 2048,
                    "temperature": 0.7,
                    "stream": True,
                },
            ) as resp:
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        return
                    try:
                        data = json.loads(data_str)
                        delta = data["choices"][0].get("delta", {})
                        content = delta.get("content")
                        if content:
                            yield content
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue

    async def _call_llm(self, prompt: str) -> str:
        """Call DeepSeek API for LLM completion."""
        if not settings.deepseek_api_key:
            return "LLM API key not configured. Please set DEEPSEEK_API_KEY."

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{settings.deepseek_base_url}/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
                json={
                    "model": "deepseek-chat",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 2048,
                    "temperature": 0.7,
                },
            )
            data = resp.json()
            return data["choices"][0]["message"]["content"]


rag_service = RAGService()
