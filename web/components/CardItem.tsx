"use client";

import type { Card } from "@/lib/api";
import { TagChip } from "@/components/TagChip";
import { MarkdownContent } from "@/components/MarkdownContent";
import { useTranslations } from "next-intl";
import { AtSign } from "lucide-react";

interface CardItemProps {
  card: Card;
  onClick: () => void;
  topicName?: string;
  topicColor?: string;
  onContextMenu?: (e: React.MouseEvent) => void;
  onMention?: (card: { cardId: string; title: string; color: string }) => void;
  compact?: boolean;
}

export function CardItem({ card, onClick, topicName, topicColor, onContextMenu, onMention, compact }: CardItemProps) {
  const t = useTranslations("common");

  const handleMention = (e: React.MouseEvent) => {
    e.stopPropagation();
    onMention?.({ cardId: card.id, title: card.title || t("unnamed"), color: card.color });
  };

  if (compact) {
    return (
      <div className="group relative mb-2 w-full break-inside-avoid">
        <button
          type="button"
          onClick={onClick}
          onContextMenu={onContextMenu}
          className="w-full cursor-pointer rounded-lg border border-border bg-surface p-2.5 text-left shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.99]"
          style={{ borderLeft: `3px solid ${card.color}` }}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {topicName && (
              <>
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: topicColor || "#6366f1" }}
                />
                <span className="min-w-0 shrink truncate text-[9px] text-text-secondary">{topicName}</span>
                <span className="shrink-0 text-[9px] text-text-secondary/30">·</span>
              </>
            )}
            <span className="min-w-0 truncate text-xs font-medium text-text">{card.title || t("unnamed")}</span>
          </div>
          <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-secondary">
            {card.content}
          </div>
        </button>
        {onMention && (
          <button
            type="button"
            onClick={handleMention}
            title="添加到 AI 上下文"
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-surface/80 text-text-secondary opacity-0 shadow-sm transition hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
          >
            <AtSign className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="group relative mb-4 w-full break-inside-avoid">
      <button
        type="button"
        onClick={onClick}
        onContextMenu={onContextMenu}
        className="w-full cursor-pointer rounded-card border border-border bg-surface p-4 text-left shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.99]"
        style={{ borderLeft: `4px solid ${card.color}` }}
      >
        {topicName && (
          <div className="mb-2 flex min-w-0 items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: topicColor || "#6366f1" }}
            />
            <span className="min-w-0 truncate text-[10px] text-text-secondary">{topicName}</span>
          </div>
        )}
        <div className="mb-1 flex min-w-0 items-center gap-2">
          {card.title && <h3 className="min-w-0 truncate font-semibold text-text">{card.title}</h3>}
          {card.emotion_tag && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-text-secondary">
              {card.emotion_tag}
            </span>
          )}
        </div>
        <div className="line-clamp-6 [&_*]:!text-sm [&_*]:!leading-relaxed [&_table]:!text-xs">
          <MarkdownContent content={card.content} />
        </div>
        {card.keywords.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {card.keywords.slice(0, 3).map((kw) => (
              <TagChip key={kw} label={kw} color={card.color} />
            ))}
          </div>
        )}
      </button>
      {onMention && (
        <button
          type="button"
          onClick={handleMention}
          title="添加到 AI 上下文"
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-surface/80 text-text-secondary opacity-0 shadow-sm transition hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
        >
          <AtSign className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
