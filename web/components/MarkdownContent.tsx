"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function fixMarkdown(text: string): string {
  // Only fix: 1) table row splitting, 2) spacing at line starts.
  // Never insert newlines mid-text — headings/lists without newlines
  // render as normal text, which is fine and consistent.
  return text
    // AI outputs || as table row separator → split into lines
    .replace(/\|\|/g, "|\n|")
    // ###标题 → ### 标题 (only at existing line starts)
    .replace(/^(#{1,6})([^\s#])/gm, "$1 $2")
    // -文字 → - 文字 (only at existing line starts)
    .replace(/^([-*+])([^\s*+-])/gm, "$1 $2")
    // 1.文字 → 1. 文字 (only at existing line starts)
    .replace(/^(\d+\.)([^\s\d])/gm, "$1 $2");
}

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words prose-headings:mb-2 prose-headings:mt-3 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-hr:my-3 prose-pre:bg-gray-100 prose-pre:text-text prose-code:text-primary-dark prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-blockquote:border-l-primary prose-blockquote:pl-3 prose-blockquote:italic">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {fixMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}
