"use client";

import { useState, useEffect, useRef } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

export function ThinkingBlock({
  content,
  isStreaming = false,
  hasContent = false,
}: {
  content: string;
  isStreaming?: boolean;
  hasContent?: boolean;
}) {
  const t = useTranslations("chat");
  const [expanded, setExpanded] = useState(true);
  const hasAutoCollapsed = useRef(false);

  // Auto-collapse once main content starts arriving
  useEffect(() => {
    if (hasContent && !hasAutoCollapsed.current && expanded) {
      hasAutoCollapsed.current = true;
      setExpanded(false);
    }
  }, [hasContent, expanded]);

  if (!content) return null;

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--muted)]/30">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]/50"
      >
        <Brain className="h-3 w-3 shrink-0 text-[var(--primary)]" />
        <span className="font-medium">{t("thinkingProcess")}</span>
        {isStreaming && expanded && (
          <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--primary)]" />
        )}
        <span className="ml-auto text-[10px]">
          {content.length} {t("chars")}
        </span>
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-[var(--border)] px-3 py-2">
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--muted-foreground)]">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}
