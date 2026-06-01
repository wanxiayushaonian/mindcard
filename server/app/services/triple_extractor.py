import json
import logging
import uuid
from dataclasses import dataclass

from app.services.llm import llm_service

logger = logging.getLogger(__name__)

NER_SYSTEM_PROMPT = """You are a named entity recognition system specialized in technical content.

Extract all named entities from the text. Entity types:
- concept: Technical concepts (e.g., RAG, Transformer, Knowledge Graph)
- tool: Tools and frameworks (e.g., pgvector, Milvus, PyTorch)
- method: Methods and algorithms (e.g., cosine similarity, BM25, GCN)
- model: Model names (e.g., BGE-M3, GPT-4, BERT)

Return a JSON array. Each object has "name" (string) and "type" (one of: concept, tool, method, model).
If no entities found, return an empty array [].

IMPORTANT: Return ONLY the JSON array, no other text."""

RE_SYSTEM_PROMPT = """You are a relation extraction system. Given a list of entities and source text, extract relation triples.

Valid relation types:
- contains: A contains B (e.g., RAG contains embedding model)
- uses: A uses B (e.g., RAG uses cosine similarity)
- depends_on: A depends on B (e.g., inference depends_on GPU)
- example_of: A is an example of B (e.g., Milvus example_of vector database)
- contradicts: A contradicts B (e.g., sparse retrieval contradicts dense retrieval)
- extends: A extends/improves B (e.g., hybrid search extends vector search)

Rules:
- Only extract relations explicitly stated or clearly implied in the text
- Head and tail MUST be entities from the provided entity list (exact match)
- Use the most specific relation type
- Return ONLY a JSON array of [head, relation, tail] arrays
- If no relations found, return []

IMPORTANT: Return ONLY the JSON array, no other text."""


@dataclass
class ExtractedEntity:
    name: str
    entity_type: str


@dataclass
class ExtractedTriple:
    head: str
    relation: str
    tail: str


class TripleExtractor:
    async def extract(
        self, card_content: str, workspace_id: uuid.UUID
    ) -> tuple[list[ExtractedEntity], list[ExtractedTriple]]:
        entities = await self._extract_entities(card_content)
        if not entities:
            return [], []
        triples = await self._extract_relations(entities, card_content)
        return entities, triples

    async def _extract_entities(self, text: str) -> list[ExtractedEntity]:
        try:
            user_prompt = f"Extract entities from:\n\n{text[:3000]}"
            response = await llm_service.complete_simple(
                system_prompt=NER_SYSTEM_PROMPT,
                user_content=user_prompt,
                max_tokens=1024,
                temperature=0.3,
            )
            parsed = self._parse_json(response)
            if not isinstance(parsed, list):
                return []
            entities = []
            for item in parsed:
                if isinstance(item, dict) and "name" in item and "type" in item:
                    entities.append(
                        ExtractedEntity(
                            name=item["name"].strip(), entity_type=item["type"]
                        )
                    )
            return entities
        except Exception as e:
            logger.warning("NER extraction failed: %s", e)
            return []

    async def _extract_relations(
        self, entities: list[ExtractedEntity], text: str
    ) -> list[ExtractedTriple]:
        try:
            entity_list = ", ".join(
                f'"{e.name}" ({e.entity_type})' for e in entities
            )
            user_prompt = (
                f"Entities: [{entity_list}]\n\n"
                f"Source text:\n{text[:3000]}\n\n"
                f"Extract relation triples."
            )
            response = await llm_service.complete_simple(
                system_prompt=RE_SYSTEM_PROMPT,
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
