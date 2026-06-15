"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Code, Copy, Eye } from "lucide-react";
import { useTranslations } from "next-intl";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      const instance = m.default;
      instance.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
      });
      return instance;
    });
  }
  return mermaidPromise;
}

let idCounter = 0;

export default function Mermaid({ chart, className }: { chart: string; className?: string }) {
  const t = useTranslations("markdown");
  const tCommon = useTranslations("common");
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(() => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(chart).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    });
  }, [chart]);

  useEffect(() => {
    if (!chart.trim() || !containerRef.current || showCode) return;

    let cancelled = false;
    const renderId = `mermaid-${++idCounter}`;

    getMermaid()
      .then((mermaid) => mermaid.render(renderId, chart))
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || "Failed to render diagram");
        }
      });

    return () => {
      cancelled = true;
      const el = document.getElementById(renderId);
      el?.remove();
    };
  }, [chart, showCode]);

  const wrapper = `my-4 overflow-hidden rounded-xl border border-border ${className || ""}`;

  return (
    <div className={wrapper}>
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-1 border-b border-border bg-muted/50 px-2 py-1">
        <button
          onClick={() => setShowCode(false)}
          className={`rounded px-2 py-0.5 text-xs transition-colors ${
            !showCode
              ? "bg-surface text-text shadow-sm"
              : "text-text-secondary hover:text-text"
          }`}
          title={t("showDiagram")}
        >
          <Eye size={12} className="inline -mt-px" />
        </button>
        <button
          onClick={() => setShowCode(true)}
          className={`rounded px-2 py-0.5 text-xs transition-colors ${
            showCode
              ? "bg-surface text-text shadow-sm"
              : "text-text-secondary hover:text-text"
          }`}
          title={t("showCode")}
        >
          <Code size={12} className="inline -mt-px" />
        </button>
      </div>

      {/* Content */}
      {showCode ? (
        <div>
          <div className="flex items-center justify-end border-b border-border px-4 py-1.5">
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-text-secondary transition-colors hover:bg-gray-200 hover:text-text dark:hover:bg-gray-300"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? tCommon("copied") : tCommon("copy")}</span>
            </button>
          </div>
          <pre className="overflow-x-auto bg-bg p-4 text-sm leading-relaxed text-text">
            <code>{chart}</code>
          </pre>
        </div>
      ) : error ? (
        <div className="px-4 py-3 text-sm text-red-600 dark:text-red-400">
          <p className="font-medium">Mermaid error</p>
          <pre className="mt-1 whitespace-pre-wrap text-xs opacity-80">{error}</pre>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex justify-center bg-muted/30 px-4 py-3 [&>svg]:max-w-full"
        />
      )}
    </div>
  );
}
