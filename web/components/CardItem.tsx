import type { Card } from "@/lib/api";
import { TagChip } from "@/components/TagChip";
import { MarkdownContent } from "@/components/MarkdownContent";

interface CardItemProps {
  card: Card;
  onClick: () => void;
  topicName?: string;
  topicColor?: string;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function CardItem({ card, onClick, topicName, topicColor, onContextMenu }: CardItemProps) {
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="mb-4 cursor-pointer break-inside-avoid rounded-card border border-border bg-surface p-4 shadow-sm transition hover:shadow-md"
      style={{ borderLeft: `4px solid ${card.color}` }}
    >
      {topicName && (
        <div className="mb-2 flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: topicColor || "#6366f1" }}
          />
          <span className="text-[10px] text-text-secondary truncate">{topicName}</span>
        </div>
      )}
      <div className="mb-1 flex items-center gap-2">
        {card.title && <h3 className="font-semibold text-text">{card.title}</h3>}
        {card.emotion_tag && (
          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-text-secondary">
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
    </div>
  );
}
