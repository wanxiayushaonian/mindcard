"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { FileText, X, Search } from "lucide-react";
import { cardApi, type Card } from "@/lib/api";

interface MentionedCard {
  cardId: string;
  title: string;
  color: string;
}

interface CardMentionPopupProps {
  workspaceId: string;
  inputValue: string;
  cursorPosition: number;
  mentionedCards: MentionedCard[];
  onAdd: (card: MentionedCard) => void;
  onRemove: (cardId: string) => void;
}

export function CardMentionPopup({
  workspaceId,
  inputValue,
  cursorPosition,
  mentionedCards,
  onAdd,
  onRemove,
}: CardMentionPopupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const atPositionRef = useRef<number>(-1);

  // Fetch workspace cards on open
  useEffect(() => {
    if (!isOpen || !workspaceId) return;
    let cancelled = false;
    setLoading(true);
    cardApi
      .list(workspaceId, { limit: 100, sort_by: "updated_at", order: "desc" })
      .then((res) => {
        if (!cancelled) setCards(res.items);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, workspaceId]);

  // Detect @ trigger from input value and cursor position
  useEffect(() => {
    const val = inputValue;
    const pos = cursorPosition;

    // Find the last @ before cursor
    const lastAt = val.lastIndexOf("@", pos - 1);
    if (lastAt >= 0) {
      const between = val.slice(lastAt + 1, pos);
      if (/^[^\n]*$/.test(between) && between.length <= 30) {
        atPositionRef.current = lastAt;
        setQuery(between);
        setIsOpen(true);
        return;
      }
    }
    setIsOpen(false);
    setQuery("");
    atPositionRef.current = -1;
  }, [inputValue, cursorPosition]);

  // Filter cards by query (title or keywords)
  const filtered = query.trim()
    ? cards.filter(
        (c) =>
          c.title.toLowerCase().includes(query.toLowerCase()) ||
          c.keywords.some((k) => k.toLowerCase().includes(query.toLowerCase()))
      )
    : cards;

  // Exclude already-mentioned cards
  const mentionIds = new Set(mentionedCards.map((m) => m.cardId));
  const available = filtered.filter((c) => !mentionIds.has(c.id));

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // Focus search input when popup opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const selectCard = useCallback(
    (card: Card) => {
      onAdd({
        cardId: card.id,
        title: card.title || "Untitled",
        color: card.color,
      });
      setIsOpen(false);
      setQuery("");
      atPositionRef.current = -1;
    },
    [onAdd]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, available.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (available[selectedIndex]) {
          selectCard(available[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
      }
    },
    [isOpen, available, selectedIndex, selectCard]
  );

  return (
    <>
      {/* Mentioned card tags */}
      {mentionedCards.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-1">
          {mentionedCards.map((mc) => (
            <span
              key={mc.cardId}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)]/10 px-2 py-0.5 text-[11px] text-[var(--color-primary)]"
              style={{ borderLeft: `3px solid ${mc.color}` }}
            >
              <FileText className="h-3 w-3" />
              <span className="max-w-[120px] truncate">{mc.title}</span>
              <button
                type="button"
                onClick={() => onRemove(mc.cardId)}
                className="ml-0.5 rounded p-0.5 hover:bg-[var(--color-primary)]/20"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Popup */}
      {isOpen && (
        <div
          ref={popupRef}
          className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-64 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg backdrop-blur-sm"
          onKeyDown={handleKeyDown}
        >
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
            <Search className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索卡片..."
              className="flex-1 bg-transparent text-[12px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-secondary)]"
            />
          </div>

          {/* Card list */}
          <div className="max-h-48 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-4 text-center text-[11px] text-[var(--color-text-secondary)]">
                加载中...
              </div>
            ) : available.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-[var(--color-text-secondary)]">
                {query ? "未找到匹配卡片" : "工作区暂无卡片"}
              </div>
            ) : (
              available.map((card, i) => (
                <button
                  key={card.id}
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
                    i === selectedIndex
                      ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                      : "hover:bg-[var(--color-gray-100)]"
                  }`}
                  onClick={() => selectCard(card)}
                  onMouseEnter={() => setSelectedIndex(i)}
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
      )}
    </>
  );
}
