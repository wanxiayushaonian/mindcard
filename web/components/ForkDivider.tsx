"use client";

import { ChevronRight, ChevronDown, GitBranch } from "lucide-react";
import { useTranslations } from "next-intl";

const DEPTH_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#f97316",
  "#ef4444",
];

const PROFILE_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  deep_dive: { label: "deepDiveLabel", color: "#1d4ed8", bg: "#dbeafe" },
  explore: { label: "exploreLabel", color: "#15803d", bg: "#dcfce7" },
  summarize: { label: "summarizeLabel", color: "#7e22ce", bg: "#f3e8ff" },
  challenge: { label: "challengeLabel", color: "#c2410c", bg: "#ffedd5" },
};

interface ForkDividerProps {
  childChatId: string;
  label: string;
  depth: number;
  messageCount: number;
  collapsed: boolean;
  parentContextSummary?: string;
  profile?: string;
  onToggle: (childChatId: string) => void;
}

export function ForkDivider({
  childChatId,
  label,
  depth,
  messageCount,
  collapsed,
  parentContextSummary,
  profile,
  onToggle,
}: ForkDividerProps) {
  const t = useTranslations("fork");
  const color = DEPTH_COLORS[depth % DEPTH_COLORS.length];
  const badge = profile ? PROFILE_BADGES[profile] : null;

  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      onClick={() => onToggle(childChatId)}
      className="w-full rounded-lg border border-border/60 bg-surface px-3 py-2 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center gap-2">
        {collapsed ? (
          <ChevronRight size={13} className="shrink-0 text-text-secondary/60" />
        ) : (
          <ChevronDown size={13} className="shrink-0 text-text-secondary/60" />
        )}
        <GitBranch size={12} className="shrink-0" style={{ color }} />
        <span className="flex-1 truncate text-sm font-medium text-text">{label}</span>
        {badge && (
          <span
            className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none"
            style={{ color: badge.color, backgroundColor: badge.bg }}
          >
            {t(badge.label as any)}
          </span>
        )}
        <span className="shrink-0 text-xs text-text-secondary/60">
          {t("messages", { count: messageCount })}
        </span>
      </div>
      {collapsed && parentContextSummary && (
        <p className="ml-[52px] mt-1 line-clamp-1 text-xs text-text-secondary/50">
          {parentContextSummary}
        </p>
      )}
    </button>
  );
}
