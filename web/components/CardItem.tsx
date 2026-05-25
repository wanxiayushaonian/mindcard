import type { Card } from "@/lib/api";
import { TagChip } from "@/components/TagChip";
import { MarkdownContent } from "@/components/MarkdownContent";

export function CardItem({ card, onClick }: { card: Card; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="mb-4 cursor-pointer break-inside-avoid rounded-card border border-border bg-surface p-4 shadow-sm transition hover:shadow-md"
      style={{ borderLeft: `4px solid ${card.color}` }}
    >
      {card.title && <h3 className="mb-1 font-semibold text-text">{card.title}</h3>}
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
