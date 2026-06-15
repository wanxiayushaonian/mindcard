"use client";

import { FileText, Search } from "lucide-react";
import type { Card } from "@/lib/api";

interface WikiLinkPopupProps {
  query: string;
  cards: Card[];
  loading: boolean;
  selectedIndex: number;
  onSelect: (card: Card) => void;
  onSelectedIndexChange: (index: number) => void;
}

export function WikiLinkPopup({
  query,
  cards,
  loading,
  selectedIndex,
  onSelect,
  onSelectedIndexChange,
}: WikiLinkPopupProps) {
  return (
    <div className="z-50 w-64 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <Search className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
        <span className="text-[12px] text-[var(--color-text-secondary)]">
          {query || "搜索卡片..."}
        </span>
      </div>

      {/* Card list */}
      <div className="max-h-48 overflow-y-auto">
        {loading ? (
          <div className="px-3 py-4 text-center text-[11px] text-[var(--color-text-secondary)]">
            加载中...
          </div>
        ) : cards.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-[var(--color-text-secondary)]">
            {query ? "未找到匹配卡片" : "工作区暂无卡片"}
          </div>
        ) : (
          cards.map((card, i) => (
            <button
              key={card.id}
              type="button"
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
                i === selectedIndex
                  ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                  : "hover:bg-[var(--color-gray-100)]"
              }`}
              onClick={() => onSelect(card)}
              onMouseEnter={() => onSelectedIndexChange(i)}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: card.color }}
              />
              <span className="truncate text-[var(--color-text)]">
                {card.title || "Untitled"}
              </span>
              {card.keywords.length > 0 && (
                <span className="ml-auto shrink-0 text-[10px] text-[var(--color-text-secondary)]">
                  {card.keywords.slice(0, 2).join(", ")}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
