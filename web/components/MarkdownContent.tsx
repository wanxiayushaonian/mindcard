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
import { useTranslations } from "next-intl";
import { CodeBlock } from "@/components/CodeBlock";
import { normalizeMarkdownForDisplay } from "@/lib/markdown-normalize";

import "katex/dist/katex.min.css";

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
  "prose prose-sm max-w-none break-words dark:prose-invert " +
  "prose-headings:font-semibold prose-headings:tracking-tight " +
  "prose-h1:text-[1.125rem] prose-h1:mt-6 prose-h1:mb-3 " +
  "prose-h2:text-[1rem] prose-h2:mt-5 prose-h2:mb-2.5 " +
  "prose-h3:text-[0.9375rem] prose-h3:mt-4 prose-h3:mb-2 " +
  "prose-h4:text-[0.875rem] prose-h4:mt-4 prose-h4:mb-2 " +
  "prose-h5:text-[0.875rem] prose-h5:mt-3 prose-h5:mb-1.5 " +
  "prose-h6:text-[0.875rem] prose-h6:mt-3 prose-h6:mb-1.5 " +
  "prose-p:text-[0.875rem] prose-p:leading-relaxed prose-p:my-2 " +
  "prose-ul:my-2 prose-ol:my-2 " +
  "prose-li:text-[0.875rem] prose-li:my-0.5 " +
  "prose-hr:my-6 " +
  "prose-pre:bg-transparent prose-pre:p-0 " +
  "prose-code:font-normal prose-code:text-[0.875rem] prose-code:before:content-none prose-code:after:content-none " +
  "prose-blockquote:border-l-2 prose-blockquote:pl-3 prose-blockquote:not-italic " +
  "prose-table:my-3 prose-th:text-left prose-th:font-medium " +
  "prose-strong:font-semibold prose-strong:text-[0.875rem] " +
  "prose-a:text-primary prose-a:underline prose-a:decoration-primary/40 prose-a:underline-offset-2";

interface MarkdownRendererProps {
  source: string;
  highlightCode: boolean;
  onPrecipitateBlock?: (text: string) => void;
}

function isSafeUrl(url: string | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  return !trimmed.startsWith("javascript:") && !trimmed.startsWith("data:") && !trimmed.startsWith("vbscript:");
}

const MarkdownRenderer = memo(function MarkdownRenderer({
  source,
  highlightCode,
  onPrecipitateBlock,
}: MarkdownRendererProps) {
  const t = useTranslations("markdown");
  const tEditor = useTranslations("editor");
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
        if (!isSafeUrl(href)) {
          return <span className="text-red-500 line-through">{markdownChildren}</span>;
        }
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
        if (!isSafeUrl(src)) {
          return <span className="text-xs text-red-500 italic">[{t("unsafeImage")}]</span>;
        }
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
                span.textContent = `[${t("imageLoadFailed")}: ${alt || src}]`;
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
          title={tEditor("precipitateTooltip")}
        >
          <Scissors size={12} />
          {tEditor("precipitate")}
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
  const normalized = useMemo(() => normalizeMarkdownForDisplay(renderedSource), [renderedSource]);
  const highlightCode = !streaming && renderedSource === content;

  return (
    <Suspense
      fallback={
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text">
          {normalized}
        </div>
      }
    >
      <MarkdownRenderer
        source={normalized}
        highlightCode={highlightCode}
        onPrecipitateBlock={onPrecipitateBlock}
      />
    </Suspense>
  );
}
