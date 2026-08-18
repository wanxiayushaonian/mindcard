"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

interface MessageNavigatorProps {
  /** Total number of navigable (user) messages */
  count: number;
  /** Currently active index (0-based) */
  currentIdx: number;
  /** Navigate to a specific index */
  onNavigate: (idx: number) => void;
  /** Disabled while streaming — rail stays visible but interactions are inert */
  disabled?: boolean;
}

/** Vertical space per dot slot: 20px button + 2px margin each side. */
const DOT_PITCH = 24;
/** Rail scroll viewport height, must match the max-h on the dot list. */
export const RAIL_HEIGHT = 240;
/** Extra dots rendered above/below the viewport so scrolling feels seamless. */
const OVERSCAN = 4;

export interface WindowRange {
  startIdx: number;
  endIdx: number;
  paddingTop: number;
  paddingBottom: number;
}

/** Windowed slice of the dot list for a given scroll position. */
export function computeWindow(scrollTop: number, count: number): WindowRange {
  if (count === 0) {
    return { startIdx: 0, endIdx: 0, paddingTop: 0, paddingBottom: 0 };
  }
  const start = Math.min(count, Math.max(0, Math.floor(scrollTop / DOT_PITCH) - OVERSCAN));
  const end = Math.min(count, Math.ceil((scrollTop + RAIL_HEIGHT) / DOT_PITCH) + OVERSCAN);
  return {
    startIdx: start,
    endIdx: end,
    paddingTop: start * DOT_PITCH,
    paddingBottom: Math.max(0, (count - end) * DOT_PITCH),
  };
}

/**
 * Vertical navigator rail on the right side of the chat scroll area.
 * Each dot represents a user message; clicking a dot or arrow jumps
 * to that message. Active dot tracks the currently-visible message.
 *
 * The dot list is windowed: only the dots near the scroll viewport are
 * rendered, so a long conversation (hundreds of messages) stays cheap —
 * the DOM holds ~RAIL_HEIGHT/DOT_PITCH + 2*OVERSCAN nodes, not `count`.
 *
 * Inspired by terminal/REPL UIs where you can hop between prompt
 * boundaries instead of scrolling the full transcript.
 */
export function MessageNavigator({
  count,
  currentIdx,
  onNavigate,
  disabled = false,
}: MessageNavigatorProps) {
  const t = useTranslations("messageNav");
  const dotListRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // Keep the active dot inside the visible window even when it moves by
  // other means (IntersectionObserver or arrow keys). Computed from the
  // index because windowed dots have no reliable offsetTop.
  useEffect(() => {
    if (disabled) return;
    const list = dotListRef.current;
    if (!list) return;
    const top = currentIdx * DOT_PITCH;
    const bottom = top + DOT_PITCH;
    if (top < list.scrollTop) {
      list.scrollTop = top;
    } else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [currentIdx, disabled]);

  const { startIdx, endIdx, paddingTop, paddingBottom } = computeWindow(scrollTop, count);

  if (count === 0) return null;

  const canPrev = !disabled && currentIdx > 0;
  const canNext = !disabled && currentIdx < count - 1;

  const visibleDots: number[] = [];
  for (let i = startIdx; i < endIdx; i++) visibleDots.push(i);

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1 rounded-full border border-border/50 bg-surface/80 px-1 py-1.5 shadow-sm backdrop-blur-sm">
      {/* Up arrow */}
      <button
        type="button"
        onClick={() => canPrev && onNavigate(currentIdx - 1)}
        disabled={!canPrev}
        title={t("prev")}
        aria-label={t("prev")}
        className="flex h-5 w-5 items-center justify-center rounded-full text-text-secondary transition hover:bg-muted hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>

      {/* Windowed indicator dots */}
      <div
        ref={dotListRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="max-h-[240px] overflow-y-auto py-1 [scrollbar-width:none]"
        style={{ scrollbarWidth: "none" }}
      >
        <div
          style={{
            paddingTop,
            paddingBottom,
          }}
        >
          {visibleDots.map((idx) => {
            const isActive = idx === currentIdx;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => !disabled && onNavigate(idx)}
                disabled={disabled}
                title={t("jumpTo", { n: idx + 1 })}
                aria-label={t("jumpTo", { n: idx + 1 })}
                aria-current={isActive ? "true" : undefined}
                className={`group flex h-5 w-5 items-center justify-center my-[2px] ${
                  isActive ? "pointer-events-none" : ""
                }`}
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
      </div>

      {/* Down arrow */}
      <button
        type="button"
        onClick={() => canNext && onNavigate(currentIdx + 1)}
        disabled={!canNext}
        title={t("next")}
        aria-label={t("next")}
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
