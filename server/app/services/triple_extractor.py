import logging
import re
import uuid
from dataclasses import dataclass

from app.services.llm import get_llm_service

logger = logging.getLogger(__name__)

# Delimiters matching GraphRAG's tuple format
_TUPLE_DEL = "<|>"
_RECORD_DEL = "##"
_COMPLETE = "<|COMPLETE|>"


@dataclass
class ExtractedEntity:
    name: str
    entity_type: str | None = None
    description: str | None = None


@dataclass
class ExtractedTriple:
    head: str
    relation: str
    tail: str
    weight: float = 1.0


class TripleExtractor:
    """Graph-style entity + relation extraction inspired by GraphRAG.

    Uses a single LLM call with custom tuple format (not JSON) for robustness.
    Supports a gleaning loop for multi-pass extraction.
    """

    # ── Public API (unchanged interface) ──────────────────────────────

    async def extract(
        self, card_content: str, workspace_id: uuid.UUID, language: str = "zh"
    ) -> tuple[list[ExtractedEntity], list[ExtractedTriple]]:
        entities, triples = await self._single_pass(card_content, language)
        if not entities:
            return [], []

        # Gleaning: one retry to catch missed items
        if len(entities) < 15:
            extra_e, extra_t = await self._glean(card_content, language, entities, triples)
            if extra_e:
                seen = {e.name for e in entities}
                for e in extra_e:
                    if e.name not in seen:
                        entities.append(e)
                        seen.add(e.name)
            if extra_t:
                seen = {(t.head, t.relation, t.tail) for t in triples}
                for t in extra_t:
                    key = (t.head, t.relation, t.tail)
                    if key not in seen:
                        triples.append(t)
                        seen.add(key)

        # Orphan filtering: remove triples referencing non-existent entities
        entity_names = {e.name for e in entities}
        triples = [t for t in triples if t.head in entity_names and t.tail in entity_names]

        logger.info(
            "Extraction done: %d entities, %d triples",
            len(entities), len(triples),
        )
        return entities, triples

    async def extract_entities_only(self, text: str, language: str = "zh") -> list[ExtractedEntity]:
        """Lightweight NER for retrieval — fast single call, no gleaning, no relations."""
        if language == "zh":
            system = (
                "从用户问题中提取关键实体名称（人物、作品、地点、概念等）。"
                "只输出实体名，每行一个，不超过5个，不要解释。"
            )
        else:
            system = (
                "Extract key entity names (people, works, places, concepts) from the user question. "
                "Output one entity per line, max 5, no explanation."
            )

        try:
            response = await get_llm_service().extraction_complete_simple(
                system_prompt=system,
                user_content=text[:500],
                max_tokens=64,
                temperature=0.0,
            )
        except Exception as e:
            logger.warning("extract_entities_only LLM call failed: %s", e)
            return []

        if not response or not response.strip():
            return []

        entities: list[ExtractedEntity] = []
        seen: set[str] = set()
        for line in response.strip().splitlines():
            name = line.strip().strip("-•·").strip()
            if name and name not in seen and len(name) <= 64:
                seen.add(name)
                entities.append(ExtractedEntity(name=name))
        return entities

    # ── Core extraction ───────────────────────────────────────────────

    async def _single_pass(
        self, text: str, language: str = "zh"
    ) -> tuple[list[ExtractedEntity], list[ExtractedTriple]]:
        system_prompt = self._build_system_prompt(language)
        user_prompt = self._build_user_prompt(text)

        logger.info("Extraction: calling LLM (text_len=%d, lang=%s)", len(text[:3000]), language)
        response = await get_llm_service().extraction_complete_simple(
            system_prompt=system_prompt,
            user_content=user_prompt,
            max_tokens=4096,
            temperature=0.2,
        )
        if not response or not response.strip():
            logger.warning("Extraction: LLM returned empty response")
            return [], []

        return self._parse_response(response)

    async def _glean(
        self, text: str, language: str,
        existing_entities: list[ExtractedEntity],
        existing_triples: list[ExtractedTriple],
    ) -> tuple[list[ExtractedEntity], list[ExtractedTriple]]:
        """Second pass: ask LLM to find anything missed."""
        existing_names = {e.name for e in existing_entities}
        existing_str = ", ".join(existing_names)

        if language == "zh":
            prompt = (
                f"以下是已提取的实体：{existing_str}\n\n"
                f"原文:\n{text[:3000]}\n\n"
                f"请补充遗漏的实体和关系，使用相同格式。如果没有遗漏，输出 {_COMPLETE}"
            )
        else:
            prompt = (
                f"Already extracted entities: {existing_str}\n\n"
                f"Text:\n{text[:3000]}\n\n"
                f"Add any missed entities and relationships using the same format. "
                f"If nothing was missed, output {_COMPLETE}"
            )

        response = await get_llm_service().extraction_complete_simple(
            system_prompt=self._build_system_prompt(language),
            user_content=prompt,
            max_tokens=2048,
            temperature=0.2,
        )
        if not response or _COMPLETE in response:
            return [], []

        entities, triples = self._parse_response(response)
        logger.info("Glean: found %d extra entities, %d extra triples", len(entities), len(triples))
        return entities, triples

    # ── Prompt construction ───────────────────────────────────────────

    def _build_system_prompt(self, language: str = "zh") -> str:
        if language == "zh":
            return f"""目标：从文本中提取实体和它们之间的关系。

步骤：
1. 识别文本中所有重要实体（人物、作品、概念、地点、组织、事件等）
2. 对每个实体，给出名称、类型和简要描述
3. 找出实体之间在文本中明确体现的关系
4. 对每对关系，给出关系描述和强度（1-10）

输出格式（严格遵守，每条记录用 {_RECORD_DEL} 分隔）：
(entity{_TUPLE_DEL}实体名{_TUPLE_DEL}类型{_TUPLE_DEL}描述)
{_RECORD_DEL}
(relationship{_TUPLE_DEL}源实体{_TUPLE_DEL}目标实体{_TUPLE_DEL}关系描述{_TUPLE_DEL}强度)
{_RECORD_DEL}
{_COMPLETE}

示例：
输入文本："哈利·波特在霍格沃茨学习魔法，他的好友罗恩和赫敏一直陪伴着他。"
输出：
(entity{_TUPLE_DEL}哈利·波特{_TUPLE_DEL}人物{_TUPLE_DEL}魔法世界的年轻巫师，故事主角)
{_RECORD_DEL}
(entity{_TUPLE_DEL}霍格沃茨{_TUPLE_DEL}地点{_TUPLE_DEL}英国魔法学校)
{_RECORD_DEL}
(entity{_TUPLE_DEL}罗恩{_TUPLE_DEL}人物{_TUPLE_DEL}哈利的好友)
{_RECORD_DEL}
(entity{_TUPLE_DEL}赫敏{_TUPLE_DEL}人物{_TUPLE_DEL}哈利的好友，优秀女巫)
{_RECORD_DEL}
(relationship{_TUPLE_DEL}哈利·波特{_TUPLE_DEL}霍格沃茨{_TUPLE_DEL}哈利在霍格沃茨学习魔法{_TUPLE_DEL}9)
{_RECORD_DEL}
(relationship{_TUPLE_DEL}哈利·波特{_TUPLE_DEL}罗恩{_TUPLE_DEL}罗恩是哈利的好友{_TUPLE_DEL}8)
{_RECORD_DEL}
(relationship{_TUPLE_DEL}哈利·波特{_TUPLE_DEL}赫敏{_TUPLE_DEL}赫敏是哈利的好友{_TUPLE_DEL}8)
{_RECORD_DEL}
{_COMPLETE}

规则：
- 实体名用原文中的名称，首字母大写（英文）或保持原样（中文）
- 关系必须在文本中有依据，不要臆造
- 只输出上述格式的记录，不要任何解释或分析"""
        else:
            return f"""Goal: Extract entities and their relationships from text.

Steps:
1. Identify all important entities (people, works, concepts, locations, organizations, events, etc.)
2. For each entity, provide name, type, and brief description
3. Find relationships between entities that are explicitly expressed in the text
4. For each relationship, provide a description and strength (1-10)

Output format (strictly follow, separate records with {_RECORD_DEL}):
(entity{_TUPLE_DEL}entity_name{_TUPLE_DEL}type{_TUPLE_DEL}description)
{_RECORD_DEL}
(relationship{_TUPLE_DEL}source{_TUPLE_DEL}target{_TUPLE_DEL}description{_TUPLE_DEL}strength)
{_RECORD_DEL}
{_COMPLETE}

Example:
Input text: "Harry Potter studied magic at Hogwarts. His friends Ron and Hermione were always by his side."
Output:
(entity{_TUPLE_DEL}Harry Potter{_TUPLE_DEL}person{_TUPLE_DEL}Young wizard, protagonist)
{_RECORD_DEL}
(entity{_TUPLE_DEL}Hogwarts{_TUPLE_DEL}location{_TUPLE_DEL}British school of magic)
{_RECORD_DEL}
(entity{_TUPLE_DEL}Ron{_TUPLE_DEL}person{_TUPLE_DEL}Harry's friend)
{_RECORD_DEL}
(entity{_TUPLE_DEL}Hermione{_TUPLE_DEL}person{_TUPLE_DEL}Harry's friend, talented witch)
{_RECORD_DEL}
(relationship{_TUPLE_DEL}Harry Potter{_TUPLE_DEL}Hogwarts{_TUPLE_DEL}Harry studied magic at Hogwarts{_TUPLE_DEL}9)
{_RECORD_DEL}
(relationship{_TUPLE_DEL}Harry Potter{_TUPLE_DEL}Ron{_TUPLE_DEL}Ron is Harry's friend{_TUPLE_DEL}8)
{_RECORD_DEL}
(relationship{_TUPLE_DEL}Harry Potter{_TUPLE_DEL}Hermione{_TUPLE_DEL}Hermione is Harry's friend{_TUPLE_DEL}8)
{_RECORD_DEL}
{_COMPLETE}

Rules:
- Entity names should match the original text
- Relationships must be supported by the text, do not fabricate
- Output ONLY the above format records, no explanation or analysis"""

    def _build_user_prompt(self, text: str) -> str:
        return f"Text:\n{text[:3000]}\n\n{_RECORD_DEL}\n"

    # ── Response parsing ──────────────────────────────────────────────

    def _parse_response(
        self, response: str
    ) -> tuple[list[ExtractedEntity], list[ExtractedTriple]]:
        entities: list[ExtractedEntity] = []
        triples: list[ExtractedTriple] = []
        seen_names: set[str] = set()
        seen_triples: set[tuple[str, str, str]] = set()

        # Split by record delimiter
        records = response.split(_RECORD_DEL)
        for raw in records:
            raw = raw.strip()
            if not raw or raw == _COMPLETE:
                continue

            # Strip surrounding parentheses
            raw = re.sub(r"^\(|\)$", "", raw).strip()
            if not raw:
                continue

            fields = raw.split(_TUPLE_DEL)
            fields = [f.strip() for f in fields]

            # Clean up record type (may have quotes/parens from LLM output)
            rec_type = fields[0].strip('"').strip("'").lower() if fields else ""

            if rec_type == "entity" and len(fields) >= 3:
                name = fields[1][:128]
                entity_type = fields[2] if len(fields) > 2 else None
                description = fields[3][:500] if len(fields) > 3 and fields[3] else None
                if name and name not in seen_names:
                    seen_names.add(name)
                    entities.append(ExtractedEntity(
                        name=name,
                        entity_type=self._clean_type(entity_type),
                        description=description,
                    ))

            elif rec_type == "relationship" and len(fields) >= 4:
                source = fields[1]
                target = fields[2]
                description = fields[3] if len(fields) > 3 else ""
                weight = 1.0
                if len(fields) > 4 and fields[4]:
                    try:
                        weight = max(0.1, min(1.0, float(fields[4]) / 10.0))
                    except (ValueError, IndexError):
                        weight = 1.0
                if source and target and source != target:
                    key = (source, description, target)
                    if key not in seen_triples:
                        seen_triples.add(key)
                        triples.append(ExtractedTriple(
                            head=source,
                            relation=description,
                            tail=target,
                            weight=weight,
                        ))

        return entities, triples

    @staticmethod
    def _clean_type(raw: str | None) -> str | None:
        if not raw:
            return None
        raw = raw.strip()
        if len(raw) > 20 or not raw:
            return None
        # Remove trailing punctuation or noise
        for ch in "。，、；：！？.,;:!?)]}":
            if ch in raw:
                raw = raw.split(ch, 1)[0]
        return raw.strip() or None


triple_extractor = TripleExtractor()
