"""Token budget allocator for RAG context assembly.

Enforces a global token budget across multiple context sources (cards,
graph paths, memory, branch insights, topology, instructions) to
prevent silent overflow of model context windows.

Design:
- estimate_tokens uses char/3.5 heuristic (zero-dependency, conservative for Chinese).
- BudgetConfig defines per-source ratios. 'query_instructions' is a hard
  reserve — never truncated. 'retrieved_cards' is the elastic bucket that
  absorbs unused budget from other buckets.
- TokenBudgetAllocator.allocate() truncates over-budget buckets by score
  (descending), redistributes spare budget to retrieved_cards.
"""

import logging
import math
from dataclasses import dataclass, field
from typing import Literal

logger = logging.getLogger(__name__)

# Source bucket keys
SourceKey = Literal[
    "current_dialog",
    "retrieved_cards",
    "graph_paths",
    "memory",
    "branch_insights",
    "topology",
    "query_instructions",
]

# Hard-reserved buckets — content always retained regardless of budget pressure.
HARD_RESERVED: frozenset[str] = frozenset({"query_instructions"})

# Elastic bucket that absorbs unused budget from other buckets.
ELASTIC_BUCKET: str = "retrieved_cards"

# Zero-dependency token estimation: char / 3.5.
# - Chinese: ~2.5 chars/token, so 3.5 overestimates by ~40% (safe).
# - English: ~4-5 chars/token, so 3.5 underestimates by ~10-30% (acceptable).
CHARS_PER_TOKEN = 3.5


def estimate_tokens(text: str) -> int:
    """Estimate token count using char/3.5 heuristic."""
    if not text:
        return 0
    return math.ceil(len(text) / CHARS_PER_TOKEN)


@dataclass(frozen=True)
class BudgetConfig:
    total_budget: int = 100_000
    # Per-source ratios (must sum to 1.0).
    ratios: dict[str, float] = field(default_factory=lambda: {
        "current_dialog": 0.30,
        "retrieved_cards": 0.25,
        "graph_paths": 0.15,
        "memory": 0.10,
        "branch_insights": 0.05,
        "topology": 0.05,
        "query_instructions": 0.10,
    })

    def bucket_budget(self, key: str) -> int:
        ratio = self.ratios.get(key, 0.0)
        return int(self.total_budget * ratio)


@dataclass
class ScoredItem:
    text: str
    score: float
    source_id: str = ""

    @property
    def tokens(self) -> int:
        return estimate_tokens(self.text)


@dataclass
class BucketStats:
    """Per-bucket statistics for debugging and observability."""
    key: str
    budget: int
    input_count: int
    input_tokens: int
    output_count: int
    output_tokens: int
    truncated: bool


class TokenBudgetAllocator:
    """Allocates a global token budget across multiple context sources.

    Truncation policy:
    1. For each bucket, compute total tokens of all items.
    2. If within bucket budget, keep all items.
    3. If over budget, sort by score descending, greedily pack items
       until next item would exceed budget.
    4. HARD_RESERVED buckets are never truncated.
    5. Spare budget from under-used buckets is redistributed to ELASTIC_BUCKET.
    """

    def __init__(self, config: BudgetConfig | None = None):
        self.config = config or BudgetConfig()

    def allocate(
        self,
        sources: dict[str, list[ScoredItem]],
    ) -> tuple[dict[str, list[ScoredItem]], list[BucketStats]]:
        """Allocate budget across sources.

        Args:
            sources: Map from bucket key to list of scored items.

        Returns:
            Tuple of (allocated items per bucket, per-bucket stats).
        """
        stats: list[BucketStats] = []
        allocated: dict[str, list[ScoredItem]] = {}
        spare_budget = 0

        # First pass: truncate non-elastic, non-hard-reserved buckets
        for key, ratio in self.config.ratios.items():
            items = sources.get(key, [])
            bucket_budget = self.config.bucket_budget(key)
            input_tokens = sum(it.tokens for it in items)

            if key in HARD_RESERVED:
                # Never truncate; actual usage may exceed ratio.
                kept = list(items)
                output_tokens = input_tokens
                truncated = False
            elif key == ELASTIC_BUCKET:
                # Defer elastic bucket to second pass (gets spare budget).
                continue
            else:
                kept, output_tokens, truncated = self._pack_items(items, bucket_budget)
                if not truncated and output_tokens < bucket_budget:
                    spare_budget += bucket_budget - output_tokens
                elif truncated:
                    logger.debug(
                        "Bucket %s over budget: %d > %d, truncated %d -> %d items",
                        key, input_tokens, bucket_budget,
                        len(items), len(kept),
                    )

            allocated[key] = kept
            stats.append(BucketStats(
                key=key, budget=bucket_budget,
                input_count=len(items), input_tokens=input_tokens,
                output_count=len(kept), output_tokens=output_tokens,
                truncated=truncated,
            ))

        # Second pass: elastic bucket gets its own budget + spare.
        elastic_items = sources.get(ELASTIC_BUCKET, [])
        elastic_budget = self.config.bucket_budget(ELASTIC_BUCKET) + spare_budget
        elastic_input_tokens = sum(it.tokens for it in elastic_items)
        kept, output_tokens, truncated = self._pack_items(elastic_items, elastic_budget)
        allocated[ELASTIC_BUCKET] = kept
        stats.append(BucketStats(
            key=ELASTIC_BUCKET, budget=elastic_budget,
            input_count=len(elastic_items), input_tokens=elastic_input_tokens,
            output_count=len(kept), output_tokens=output_tokens,
            truncated=truncated,
        ))

        return allocated, stats

    @staticmethod
    def _pack_items(
        items: list[ScoredItem],
        budget: int,
    ) -> tuple[list[ScoredItem], int, bool]:
        """Greedily pack items into budget, highest score first.

        First item is always kept even if it alone exceeds budget (no way to
        make progress otherwise). In that case, truncated=True flags the
        overflow so the caller can warn.

        Returns (kept_items, total_tokens, truncated).
        """
        if not items:
            return [], 0, False

        sorted_items = sorted(items, key=lambda it: it.score, reverse=True)
        kept: list[ScoredItem] = []
        used = 0
        for it in sorted_items:
            if used + it.tokens > budget and kept:
                break
            kept.append(it)
            used += it.tokens

        # truncated if some items were dropped OR kept items exceed budget
        # (single oversized item case)
        truncated = len(kept) < len(items) or used > budget
        return kept, used, truncated

    def format_stats(self, stats: list[BucketStats]) -> str:
        """Human-readable budget summary for logging/debugging."""
        lines = []
        total_in = sum(s.input_tokens for s in stats)
        total_out = sum(s.output_tokens for s in stats)
        lines.append(f"Budget {self.config.total_budget} | in={total_in} out={total_out}")
        for s in stats:
            mark = "!" if s.truncated else " "
            lines.append(
                f"  {mark} {s.key:20s} budget={s.budget:6d} "
                f"in={s.input_tokens:6d} out={s.output_tokens:6d} "
                f"({s.input_count}->{s.output_count} items)"
            )
        return "\n".join(lines)
