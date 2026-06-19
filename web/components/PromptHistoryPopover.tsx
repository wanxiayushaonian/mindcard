"use client";

import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { History, Clock } from "lucide-react";
import { useTranslations } from "next-intl";

interface PromptHistoryPopoverProps {
  prompts: string[];
  onSelect: (text: string) => void;
  onClose: () => void;
  anchorEl: HTMLElement | null;
}

export function PromptHistoryPopover({
  prompts,
  onSelect,
  onClose,
  anchorEl,
}: PromptHistoryPopoverProps) {
  const t = useTranslations("promptHistory");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Position popover above the anchor (toolbar)
  useLayoutEffect(() => {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const popoverWidth = 360;
    let left = rect.left;
    if (left + popoverWidth > window.innerWidth - 8) {
      left = window.innerWidth - popoverWidth - 8;
    }
    if (left < 8) left = 8;
    setPos({ top: rect.top - 8, left });
  }, [anchorEl]);

  // ESC + click outside + arrow keys
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, prompts.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && prompts[highlightIdx]) {
        e.preventDefault();
        onSelect(prompts[highlightIdx]);
      }
    };
    const clickHandler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (anchorEl?.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", handler);
    document.addEventListener("mousedown", clickHandler);
    return () => {
      document.removeEventListener("keydown", handler);
      document.removeEventListener("mousedown", clickHandler);
    };
  }, [onClose, onSelect, prompts, highlightIdx, anchorEl]);

  if (prompts.length === 0) {
    return (
      <div
        ref={containerRef}
        className="fixed z-[10000] w-[360px] rounded-lg border border-border bg-surface p-3 text-xs text-text-secondary shadow-xl"
        style={{ top: pos.top - 60, left: pos.left, transform: "translateY(-100%)" }}
      >
        <div className="flex items-center gap-1.5">
          <History className="h-3 w-3" />
          <span>{t("noHistory")}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-[10000] flex max-h-72 w-[360px] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
      style={{ top: pos.top - 4, left: pos.left, transform: "translateY(-100%)" }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-3 py-1.5 text-[10px] text-text-secondary">
        <History className="h-3 w-3" />
        <span className="flex-1">{t("title")}</span>
        <span className="rounded bg-muted px-1 py-0.5 text-[9px]">{t("hint")}</span>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {prompts.map((p, idx) => (
          <button
            key={`${idx}-${p.slice(0, 20)}`}
            type="button"
            onMouseEnter={() => setHighlightIdx(idx)}
            onClick={() => onSelect(p)}
            className={`flex w-full items-start gap-1.5 px-3 py-1.5 text-left text-xs transition-colors ${
              idx === highlightIdx
                ? "bg-primary/10 text-primary"
                : "text-text hover:bg-muted/60"
            }`}
          >
            <Clock className="mt-0.5 h-3 w-3 shrink-0 opacity-50" />
            <span className="line-clamp-2 flex-1 break-words">{p}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
