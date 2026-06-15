"use client";

import { useState } from "react";
import { Wrench, ChevronDown, ChevronRight, Check, Copy, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ToolCall } from "@/lib/unified-ws";

const TOOL_ICONS: Record<string, string> = {
  create_fork: "🌿",
  memory_edit: "📝",
  search_cards: "🔍",
};

function ToolCallItem({ call }: { call: ToolCall }) {
  const t = useTranslations("chat");
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const isPending = call.status === "pending";

  const onCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(call, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const icon = TOOL_ICONS[call.name] || "🔧";
  const KNOWN_TOOLS = ["create_fork", "memory_edit", "search_cards"] as const;
  type KnownTool = typeof KNOWN_TOOLS[number];
  const TOOL_LABEL_KEYS: Record<KnownTool, string> = {
    create_fork: "toolLabel_create_fork",
    memory_edit: "toolLabel_memory_edit",
    search_cards: "toolLabel_search_cards",
  };
  const labelKey = TOOL_LABEL_KEYS[call.name as KnownTool];
  const label = labelKey ? t(labelKey as any) : call.name.replace(/_/g, " ");

  let resultPreview = call.result;
  if (!isPending) {
    try {
      const parsed = JSON.parse(call.result);
      resultPreview = parsed.status || parsed.message || call.result.slice(0, 100);
    } catch {
      resultPreview = call.result.slice(0, 100);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
      <button
        type="button"
        onClick={() => !isPending && setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-[var(--muted)]/30"
      >
        <span className="text-sm">{icon}</span>
        <span className="font-medium text-[var(--foreground)]">{label}</span>
        {isPending ? (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("toolExecuting")}
          </span>
        ) : (
          <>
            <span className="ml-auto truncate text-[11px] text-[var(--muted-foreground)] max-w-[200px]">
              {resultPreview}
            </span>
            {expanded ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" />
            )}
          </>
        )}
      </button>
      {!isPending && expanded && (
        <div className="border-t border-[var(--border)] px-3 py-2 space-y-2">
          {Object.keys(call.arguments).length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                {t("toolArguments")}
              </div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(call.arguments).map(([key, value]) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1 rounded bg-[var(--muted)] px-1.5 py-0.5 text-[11px]"
                  >
                    <span className="text-[var(--muted-foreground)]">{key}:</span>
                    <span className="text-[var(--foreground)]">
                      {typeof value === "string" ? value.slice(0, 50) : JSON.stringify(value).slice(0, 50)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                {t("toolResult")}
              </span>
              <button
                type="button"
                onClick={onCopy}
                className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? t("toolCopied") : t("toolCopy")}
              </button>
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--muted)] p-2 text-[11px] leading-relaxed text-[var(--foreground)]">
              {call.result}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export function ToolCallsBlock({ calls }: { calls: ToolCall[] }) {
  const t = useTranslations("chat");

  if (!calls || calls.length === 0) return null;

  return (
    <div className="mb-2 space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
        <Wrench className="h-3 w-3" />
        <span className="font-medium">
          {t("toolsUsed", { count: calls.length })}
        </span>
      </div>
      {calls.map((call, i) => (
        <ToolCallItem key={i} call={call} />
      ))}
    </div>
  );
}
