import json
import logging
import uuid
from dataclasses import dataclass

from app.services.llm import llm_service

logger = logging.getLogger(__name__)


@dataclass
class ExtractedEntity:
    name: str
    entity_type: str | None = None  # Optional, for backward compatibility


@dataclass
class ExtractedTriple:
    head: str
    relation: str
    tail: str


class TripleExtractor:
    async def extract(
        self, card_content: str, workspace_id: uuid.UUID, language: str = "zh"
    ) -> tuple[list[ExtractedEntity], list[ExtractedTriple]]:
        entities = await self._extract_entities(card_content, language)
        if not entities:
            return [], []
        triples = await self._extract_relations(entities, card_content, language)
        return entities, triples

    async def _extract_entities(self, text: str, language: str = "zh") -> list[ExtractedEntity]:
        try:
            from app.services.graph_evolution import graph_evolution

            system_prompt = graph_evolution.build_few_shot_ner_prompt(language)
            user_prompt = f"Extract entities from:\n\n{text[:3000]}"
            response = await llm_service.complete_simple(
                system_prompt=system_prompt,
                user_content=user_prompt,
                max_tokens=1024,
                temperature=0.3,
            )
            parsed = self._parse_json(response)
            if not isinstance(parsed, list):
                return []
            entities = []
            for item in parsed:
                if isinstance(item, dict) and "name" in item:
                    entities.append(
                        ExtractedEntity(
                            name=item["name"].strip(),
                            entity_type=item.get("type")  # Optional type
                        )
                    )
                elif isinstance(item, str):
                    # Support simple string list format
                    entities.append(ExtractedEntity(name=item.strip()))
            return entities
        except Exception as e:
            logger.warning("NER extraction failed: %s", e)
            return []

    async def _extract_relations(
        self, entities: list[ExtractedEntity], text: str, language: str = "zh"
    ) -> list[ExtractedTriple]:
        try:
            from app.services.graph_evolution import graph_evolution

            system_prompt = graph_evolution.build_few_shot_re_prompt(language)
            entity_list = ", ".join(
                f'"{e.name}" ({e.entity_type})' if e.entity_type else f'"{e.name}"'
                for e in entities
            )
            user_prompt = (
                f"Entities: [{entity_list}]\n\n"
                f"Source text:\n{text[:3000]}\n\n"
                f"Extract relation triples."
            )
            response = await llm_service.complete_simple(
                system_prompt=system_prompt,
                user_content=user_prompt,
                max_tokens=1024,
                temperature=0.3,
            )
            parsed = self._parse_json(response)
            if not isinstance(parsed, list):
                return []
            entity_names = {e.name for e in entities}
            triples = []
            for item in parsed:
                if (
                    isinstance(item, list)
                    and len(item) == 3
                    and item[0] in entity_names
                    and item[2] in entity_names
                ):
                    triples.append(
                        ExtractedTriple(
                            head=item[0], relation=item[1], tail=item[2]
                        )
                    )
            return triples
        except Exception as e:
            logger.warning("RE extraction failed: %s", e)
            return []

    @staticmethod
    def _parse_json(text: str) -> list | dict | None:
        text = text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0]
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            start = text.find("[")
            end = text.rfind("]")
            if start != -1 and end != -1:
                try:
                    return json.loads(text[start : end + 1])
                except json.JSONDecodeError:
                    pass
            return None


triple_extractor = TripleExtractor()
