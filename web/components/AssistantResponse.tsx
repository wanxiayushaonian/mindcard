"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import MarkdownRenderer from "@/components/MarkdownRenderer";
import { hasVisibleMarkdownContent } from "@/lib/markdown-display";

interface AssistantResponseProps {
  content: string;
  className?: string;
}

interface ContentSegment {
  type: "thinking" | "content";
  text: string;
}

function parseThinkingSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const regex = /<thinking>([\s\S]*?)<\/thinking>/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Content before the thinking block
    if (match.index > lastIndex) {
      const before = content.slice(lastIndex, match.index).trim();
      if (before) {
        segments.push({ type: "content", text: before });
      }
    }
    // The thinking block
    const thinking = match[1].trim();
    if (thinking) {
      segments.push({ type: "thinking", text: thinking });
    }
    lastIndex = match.index + match[0].length;
  }

  // Remaining content after last thinking block
  if (lastIndex < content.length) {
    const after = content.slice(lastIndex).trim();
    if (after) {
      segments.push({ type: "content", text: after });
    }
  }

  // If no thinking blocks found, return entire content as one segment
  if (segments.length === 0 && content.trim()) {
    segments.push({ type: "content", text: content });
  }

  return segments;
}

function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-100/50 dark:hover:bg-amber-900/20 rounded-lg transition"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
        <span className="font-medium">思考过程</span>
        {!expanded && (
          <span className="text-amber-400 dark:text-amber-600 ml-1 truncate">
            {text.slice(0, 60)}...
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 text-xs text-amber-700 dark:text-amber-300 leading-relaxed border-t border-amber-200 dark:border-amber-800">
          <MarkdownRenderer content={text} variant="prose" className="text-[12px]" />
        </div>
      )}
    </div>
  );
}

export default function AssistantResponse({
  content,
  className = "text-[14px] leading-[1.75]",
}: AssistantResponseProps) {
  const segments = useMemo(() => parseThinkingSegments(content), [content]);
  const hasContent = useMemo(
    () => hasVisibleMarkdownContent(content),
    [content],
  );

  if (!hasContent) return null;

  return (
    <div className={className}>
      {segments.map((seg, i) =>
        seg.type === "thinking" ? (
          <ThinkingBlock key={i} text={seg.text} />
        ) : (
          <Fragment key={i}>
            <MarkdownRenderer
              content={seg.text}
              variant="prose"
              className="text-[var(--foreground)]"
            />
          </Fragment>
        ),
      )}
    </div>
  );
}
