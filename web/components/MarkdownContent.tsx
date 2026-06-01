"use client";

import {
  Children,
  isValidElement,
  memo,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Scissors } from "lucide-react";
import { CodeBlock } from "@/components/CodeBlock";

import "katex/dist/katex.min.css";

// --- fixMarkdown: repair common AI markdown issues ---

function fixMarkdown(text: string): string {
  let s = text.replace(/\\n/g, "\n");

  // Strip leading whitespace that would cause indented-code-block rendering.
  // In standard Markdown, 4+ leading spaces = code block. AI output often
  // indents prose uniformly, which should be rendered as normal text.
  const rawLines = s.split("\n");
  const indented = rawLines.filter((l) => /^\s{4,}\S/.test(l));
  // If most lines have 4+ space indent, it's likely AI-formatted prose, not code
  if (indented.length >= 2 && indented.length >= rawLines.filter((l) => l.trim().length > 0).length * 0.6) {
    const minIndent = Math.min(...indented.map((l) => l.match(/^(\s*)/)?.[1]?.length ?? 0));
    s = rawLines
      .map((l) => (/^\s{4,}\S/.test(l) ? l.slice(minIndent) : l))
      .join("\n");
  }

  // Step 0: Handle || as table row separator
  const parts = s.split("||");
  if (parts.length > 1) {
    const merged: string[] = [parts[0]];
    for (let i = 1; i < parts.length; i++) {
      const prev = merged[merged.length - 1];
      const part = parts[i];
      const partTrimmed = part.trimStart();
      const partIsSep = /^\s*-{2,}/.test(partTrimmed);
      const partHasPipes = (partTrimmed.match(/\|/g) || []).length >= 2;

      if (partIsSep || partHasPipes) {
        const prevRstrip = prev.trimEnd();
        if (prevRstrip.endsWith("|")) {
          merged[merged.length - 1] = prev;
        } else {
          merged[merged.length - 1] = prevRstrip + "|";
        }
        merged.push(partTrimmed.startsWith("|") ? part : "|" + part);
      } else {
        merged[merged.length - 1] = prev + "||" + part;
      }
    }
    s = merged.join("\n");
  }

  // Step 1: Add space after ## if missing
  s = s.replace(/(#{1,6})([^\s#])/g, "$1 $2");

  // Step 2: Insert newline before ## heading glued to text
  s = s.replace(/([^\n])(#{1,6}\s)/g, "$1\n\n$2");

  // Step 3: Line-by-line processing
  const lines = s.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();

    // Split text glued to table
    if (!trimmed.startsWith("|") && /\|\s*\S+\s*\|/.test(trimmed)) {
      const idx = trimmed.indexOf("|");
      if (idx > 0) {
        const textPart = trimmed.slice(0, idx).trim();
        const tablePart = trimmed.slice(idx);
        if (textPart) result.push(textPart);
        result.push(tablePart);
        continue;
      }
    }

    // Bare separator rows like ------ ------ → convert to pipe format
    if (/^-{2,}(\s+-{2,})+$/.test(trimmed)) {
      const cols = trimmed.split(/\s+/).filter(Boolean).length;
      result.push("|" + Array(Math.max(cols, 1)).fill("---").join("|") + "|");
      continue;
    }

    // Already pipe-formatted rows (table or separator)
    if (/^\|[\s\-:|]+\|$/.test(trimmed) || /^\|.+\|$/.test(trimmed)) {
      result.push(line);
      continue;
    }

    // Split inline "-xxx" after punctuation/brackets into new list items
    // e.g., "发言。-阶段一" → "发言。\n- 阶段一"
    // e.g., "内容）-当对话" → "内容）\n- 当对话"
    let processed = line.replace(
      /([。！？；：）】」》)\]}>])(-)([^\s])/g,
      "$1\n- $3"
    );
    // Split inline "-xxx：yyy" glued to Chinese text (no preceding punctuation)
    // e.g., "潜在挑战-数据一致性：xxx-存储成本：yyy"
    //   → "潜在挑战\n- 数据一致性：xxx\n- 存储成本：yyy"
    // Loop to handle multiple occurrences on the same line
    let prev = "";
    while (prev !== processed) {
      prev = processed;
      processed = processed.replace(
        /([一-鿿])(-[一-鿿])/,
        "$1\n$2"
      );
    }
    // Normalize: "-Chinese" (no space) → "- Chinese" to ensure consistent list rendering
    // This handles cases where the split gives "-知识联想" instead of "- 知识联想"
    processed = processed.replace(/^(-)([一-鿿])/, "$1 $2");
    result.push(processed);
  }
  s = result.join("\n");

  // Step 3.5: Normalize inline list items — ensure "- Chinese" has space, and
  // if a short heading-like line is immediately followed by 2+ dash-prefixed items,
  // convert it to a list item for consistency.
  const normLines = s.split("\n");
  const normResult: string[] = [];
  let i35 = 0;
  while (i35 < normLines.length) {
    const line = normLines[i35];
    const trimmed = line.trim();
    const startsWithDash = /^-[一-鿿]/.test(trimmed);
    const startsWithDashSpace = /^- [一-鿿]/.test(trimmed);

    if (startsWithDash && !startsWithDashSpace) {
      // "-Chinese" → "- Chinese"
      normResult.push(line.replace(/^(\s*)(-)([一-鿿])/, "$1$2 $3"));
    } else if (!startsWithDash && !startsWithDashSpace && trimmed.length > 0) {
      // Check if this short text is followed by 2+ dash-prefixed items
      let dashCount = 0;
      let nextHasColon = false;
      let j = i35 + 1;
      while (j < normLines.length && j < i35 + 10) {
        const nextTrimmed = normLines[j].trim();
        if (/^-[一-鿿]/.test(nextTrimmed) || /^- [一-鿿]/.test(nextTrimmed)) {
          dashCount++;
          if (/：/.test(nextTrimmed)) nextHasColon = true;
          j++;
        } else {
          break;
        }
      }
      // Convert to list item only if:
      // - short text (< 20 chars), no sentence-ending punctuation
      // - followed by 3+ dash-prefixed items (increased from 2)
      // - current line has colon AND following items also have colons (both must have colons)
      // - NOT a heading (no # prefix)
      const isShort = trimmed.length < 20 && !/[。！？；.!?]/.test(trimmed);
      const currentHasColon = /：/.test(trimmed);
      const isHeading = /^#{1,6}\s/.test(trimmed);
      // Only convert if: short, has colon, next items have colons, 3+ items, not a heading
      if (isShort && currentHasColon && nextHasColon && dashCount >= 3 && !isHeading) {
        normResult.push("- " + trimmed);
      } else {
        normResult.push(line);
      }
    } else {
      normResult.push(line);
    }
    i35++;
  }
  s = normResult.join("\n");

  // Step 4: Convert space-separated table regions and insert separators
  // This handles cases like:
  //   col1    col2    col3
  //   val1    val2    val3
  //   ---    ---    ---
  //   val4    val5    val6
  const sLines = s.split("\n");
  const final: string[] = [];
  const isSepRow = (t: string) => /^\|[\s\-:|]+\|$/.test(t);
  const isPipeRow = (t: string) => /^\|.+\|$/.test(t);
  const isSpaceRow = (t: string) => /^(\S+\s{2,})+\S+$/.test(t);
  const getColCount = (t: string) => {
    if (isPipeRow(t)) return (t.match(/\|/g) || []).length - 1;
    return t.split(/\s{2,}/).filter(Boolean).length;
  };
  const toPipe = (t: string) => {
    if (isPipeRow(t)) return t;
    const cells = t.split(/\s{2,}/).filter(Boolean);
    return "| " + cells.join(" | ") + " |";
  };

  let i4 = 0;
  while (i4 < sLines.length) {
    const trimmed = sLines[i4].trim();
    if (isPipeRow(trimmed) || isSpaceRow(trimmed)) {
      // Collect all consecutive table-like rows
      const region: { text: string; isSep: boolean }[] = [];
      let j = i4;
      while (j < sLines.length) {
        const t = sLines[j].trim();
        if (isPipeRow(t) || isSpaceRow(t)) {
          region.push({ text: t, isSep: isSepRow(t) });
          j++;
        } else {
          break;
        }
      }
      // Convert all to pipe format
      const pipeRows = region.map((r) => toPipe(r.text));
      // Check if a separator already exists in the region
      const hasExistingSep = region.some((r) => r.isSep);
      // Output rows: insert separator after first non-separator row only if
      // no separator exists elsewhere in the region
      let headerDone = false;
      for (let k = 0; k < pipeRows.length; k++) {
        const row = pipeRows[k];
        const rowIsSep = region[k].isSep;
        if (rowIsSep) {
          final.push(row);
        } else {
          final.push(row);
          if (!headerDone && !hasExistingSep) {
            const cols = getColCount(row);
            if (cols >= 1) {
              final.push("|" + Array(cols).fill("---").join("|") + "|");
            }
          }
          headerDone = true;
        }
      }
      i4 = j;
    } else {
      final.push(sLines[i4]);
      i4++;
    }
  }
  s = final.join("\n");

  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

// --- Streaming-aware markdown throttle ---

const SHORT_STREAM_COMMIT_MS = 80;
const MEDIUM_STREAM_COMMIT_MS = 140;
const LONG_STREAM_COMMIT_MS = 220;

function streamingCommitDelay(length: number): number {
  if (length > 24_000) return LONG_STREAM_COMMIT_MS;
  if (length > 8_000) return MEDIUM_STREAM_COMMIT_MS;
  return SHORT_STREAM_COMMIT_MS;
}

function useStreamingMarkdownSource(source: string, streaming: boolean): string {
  const [renderedSource, setRenderedSource] = useState(source);
  const latestSourceRef = useRef(source);
  const renderedSourceRef = useRef(source);
  const timerRef = useRef<number | null>(null);

  const clearPendingCommit = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const commitSource = useCallback((next: string, urgent: boolean) => {
    if (renderedSourceRef.current === next) return;
    renderedSourceRef.current = next;
    if (urgent) {
      setRenderedSource(next);
      return;
    }
    startTransition(() => setRenderedSource(next));
  }, []);

  const scheduleCommit = useCallback(() => {
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      commitSource(latestSourceRef.current, false);
    }, streamingCommitDelay(latestSourceRef.current.length));
  }, [commitSource]);

  latestSourceRef.current = source;

  useLayoutEffect(() => {
    latestSourceRef.current = source;
    if (!streaming) {
      clearPendingCommit();
      commitSource(source, true);
    }
  }, [clearPendingCommit, commitSource, source, streaming]);

  useEffect(() => {
    latestSourceRef.current = source;
    if (!streaming) return;
    scheduleCommit();
  }, [scheduleCommit, source, streaming]);

  useEffect(() => clearPendingCommit, [clearPendingCommit]);

  return renderedSource;
}

// --- Markdown renderer with custom components ---

const remarkPlugins = [remarkBreaks, remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

const PROSE_CLASSES =
  "prose prose-sm max-w-none break-words dark:prose-invert prose-headings:font-semibold prose-headings:mb-2 prose-headings:mt-4 prose-headings:tracking-tight prose-h1:text-[1.125rem] prose-h2:text-[1rem] prose-h3:text-[0.9375rem] prose-h4:text-[0.875rem] prose-h5:text-[0.875rem] prose-h6:text-[0.875rem] prose-p:my-2 prose-p:text-[0.875rem] prose-p:leading-relaxed prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:text-[0.875rem] prose-hr:my-6 prose-pre:bg-transparent prose-pre:p-0 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-blockquote:border-l-2 prose-blockquote:pl-3 prose-blockquote:not-italic prose-table:my-3 prose-th:text-left prose-th:font-medium prose-strong:font-semibold prose-strong:text-[0.875rem]";

interface MarkdownRendererProps {
  source: string;
  highlightCode: boolean;
  onPrecipitateBlock?: (text: string) => void;
}

const MarkdownRenderer = memo(function MarkdownRenderer({
  source,
  highlightCode,
  onPrecipitateBlock,
}: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectionState, setSelectionState] = useState<{ text: string; x: number; y: number } | null>(null);
  const onPrecipitateBlockRef = useRef(onPrecipitateBlock);
  onPrecipitateBlockRef.current = onPrecipitateBlock;

  const handlePrecipitate = useCallback(() => {
    if (selectionState?.text && onPrecipitateBlockRef.current) {
      onPrecipitateBlockRef.current(selectionState.text);
      setSelectionState(null);
      window.getSelection()?.removeAllRanges();
    }
  }, [selectionState]);

  useEffect(() => {
    if (!onPrecipitateBlock) return;

    const handleMouseUp = () => {
      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (!text || !containerRef.current) {
          setSelectionState(null);
          return;
        }

        // Check if selection is within our container
        const range = selection?.getRangeAt(0);
        if (!range || !containerRef.current.contains(range.commonAncestorContainer)) {
          setSelectionState(null);
          return;
        }

        const rect = range.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();
        setSelectionState({
          text,
          x: rect.left - containerRect.left + rect.width / 2,
          y: rect.top - containerRect.top - 8,
        });
      }, 10);
    };

    const handleMouseDown = (e: MouseEvent) => {
      // Don't clear if clicking the precipitate button
      if ((e.target as HTMLElement).closest("[data-precipitate-btn]")) return;
      setSelectionState(null);
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [onPrecipitateBlock]);

  const components = useMemo<Components>(
    () => ({
      code({ className: cls, children: kids, ...props }) {
        const match = /language-(\w+)/.exec(cls || "");
        if (match) {
          const codeStr = String(kids).replace(/\n$/, "");
          return (
            <CodeBlock
              language={match[1]}
              code={codeStr}
              className="my-3"
              highlight={highlightCode}
            />
          );
        }
        const raw = String(kids).replace(/\n$/, "");
        const isBlock = raw.includes("\n") || raw.length > 120;
        if (isBlock) {
          return (
            <code
              className="block min-w-0 whitespace-pre bg-transparent p-0 font-mono text-[0.8125rem] leading-snug text-inherit"
              {...props}
            >
              {kids}
            </code>
          );
        }
        return (
          <code
            className={`rounded bg-gray-100 dark:bg-gray-800 px-1 py-0.5 font-mono text-[0.85em] ${cls || ""}`}
            {...props}
          >
            {kids}
          </code>
        );
      },
      pre({ children: markdownChildren }) {
        const kids = Children.toArray(markdownChildren);
        const lone = kids.length === 1 ? kids[0] : null;
        if (lone != null && isValidElement(lone) && lone.type === CodeBlock) {
          return <>{markdownChildren}</>;
        }
        return (
          <pre className="my-3 overflow-x-auto rounded-lg border border-border bg-gray-50 dark:bg-gray-900 p-3 font-mono text-[0.8125rem] leading-snug whitespace-pre">
            {markdownChildren}
          </pre>
        );
      },
      a({ href, children: markdownChildren, ...props }) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline underline-offset-2 hover:opacity-80"
            {...props}
          >
            {markdownChildren}
          </a>
        );
      },
      img({ src, alt, ...props }) {
        return (
          <span className="block my-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt || ""}
              loading="lazy"
              className="max-w-full h-auto rounded-md border border-border"
              onError={(e) => {
                const target = e.currentTarget;
                target.style.display = "none";
                const span = document.createElement("span");
                span.className = "text-xs text-text-secondary italic";
                span.textContent = `[图片加载失败: ${alt || src}]`;
                target.parentNode?.insertBefore(span, target);
              }}
              {...props}
            />
          </span>
        );
      },
    }),
    [highlightCode],
  );

  return (
    <div ref={containerRef} className={`relative ${PROSE_CLASSES}`} style={{ lineHeight: "var(--cjk-line-height)" }}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {source}
      </ReactMarkdown>
      {onPrecipitateBlock && selectionState && (
        <button
          data-precipitate-btn
          onClick={handlePrecipitate}
          className="absolute z-50 flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-secondary shadow-md transition hover:border-primary hover:text-primary-dark"
          style={{
            left: `${selectionState.x}px`,
            top: `${selectionState.y}px`,
            transform: "translate(-50%, -100%)",
          }}
          title="沉淀选取内容为卡片"
        >
          <Scissors size={12} />
          沉淀
        </button>
      )}
    </div>
  );
});

// --- Main export: streaming-aware MarkdownContent ---

interface MarkdownContentProps {
  content: string;
  streaming?: boolean;
  onPrecipitateBlock?: (text: string) => void;
}

export function MarkdownContent({
  content,
  streaming = false,
  onPrecipitateBlock,
}: MarkdownContentProps) {
  const renderedSource = useStreamingMarkdownSource(content, streaming);
  const fixed = useMemo(() => fixMarkdown(renderedSource), [renderedSource]);
  const highlightCode = !streaming && renderedSource === content;

  return (
    <Suspense
      fallback={
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text">
          {fixed}
        </div>
      }
    >
      <MarkdownRenderer
        source={fixed}
        highlightCode={highlightCode}
        onPrecipitateBlock={onPrecipitateBlock}
      />
    </Suspense>
  );
}
