"use client";

import { useEffect, useRef } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

interface MessageNavigatorProps {
  /** Total number of navigable (user) messages */
  count: number;
  /** Currently active index (0-based) */
  currentIdx: number;
  /** Navigate to a specific index */
  onNavigate: (idx: number) => void;
  /** Disabled while streaming or when no messages */
  disabled?: boolean;
}

/**
 * Vertical navigator rail on the right side of the chat scroll area.
 * Each dot represents a user message; clicking a dot or arrow jumps
 * to that message. Active dot tracks the currently-visible message.
 *
 * Inspired by terminal/REPL UIs where you can hop between prompt
 * boundaries instead of scrolling the full transcript.
 */
export function MessageNavigator({
  count,
  currentIdx,
  onNavigate,
  disabled,
}: MessageNavigatorProps) {
  const t = useTranslations("messageNav");
  const activeRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll the active dot into view within the rail
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentIdx]);

  if (disabled || count === 0) return null;

  const canPrev = currentIdx > 0;
  const canNext = currentIdx < count - 1;

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1 rounded-full border border-border/50 bg-surface/80 px-1 py-1.5 shadow-sm backdrop-blur-sm">
      {/* Up arrow */}
      <button
        type="button"
        onClick={() => canPrev && onNavigate(currentIdx - 1)}
        disabled={!canPrev}
        title={t("prev")}
        className="flex h-5 w-5 items-center justify-center rounded-full text-text-secondary transition hover:bg-muted hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>

      {/* Indicator dots */}
      <div
        className="flex max-h-[240px] flex-col items-center gap-1 overflow-y-auto py-1 [scrollbar-width:none]"
        style={{ scrollbarWidth: "none" }}
      >
        {Array.from({ length: count }).map((_, idx) => {
          const isActive = idx === currentIdx;
          return (
            <button
              key={idx}
              ref={isActive ? activeRef : undefined}
              type="button"
              onClick={() => onNavigate(idx)}
              title={t("jumpTo", { n: idx + 1 })}
              className="group flex h-3 w-3 items-center justify-center"
            >
              <span
                className={`block rounded-full transition-all ${
                  isActive
                    ? "h-2 w-2 bg-primary shadow-sm"
                    : "h-1.5 w-1.5 bg-text-secondary/60 group-hover:h-2 group-hover:w-2 group-hover:bg-text-secondary"
                }`}
              />
            </button>
          );
        })}
      </div>

      {/* Down arrow */}
      <button
        type="button"
        onClick={() => canNext && onNavigate(currentIdx + 1)}
        disabled={!canNext}
        title={t("next")}
        className="flex h-5 w-5 items-center justify-center rounded-full text-text-secondary transition hover:bg-muted hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {/* Counter */}
      {count > 1 && (
        <div className="mt-0.5 text-[9px] tabular-nums text-text-secondary/70">
          {currentIdx + 1}/{count}
        </div>
      )}
    </div>
  );
}
