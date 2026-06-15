"use client";

import SimpleMarkdownRenderer from "./SimpleMarkdownRenderer";

export interface MarkdownRendererProps {
  content: string;
  className?: string;
  variant?: "default" | "compact" | "prose" | "trace";
  streaming?: boolean;
  enableMath?: boolean;
  enableCode?: boolean;
  enableMermaid?: boolean;
  allowHtml?: boolean;
  trackSourceLines?: boolean;
}

export default function MarkdownRenderer({
  content,
  className = "",
  variant = "default",
  streaming = false,
}: MarkdownRendererProps) {
  // For now, always use SimpleMarkdownRenderer
  // RichMarkdownRenderer can be added later if needed
  return (
    <SimpleMarkdownRenderer
      content={content}
      className={className}
      variant={variant}
      streaming={streaming}
    />
  );
}
