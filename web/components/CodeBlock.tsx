"use client";

import { Suspense, lazy, useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";

interface CodeBlockProps {
  language?: string;
  code: string;
  className?: string;
  highlight?: boolean;
}

interface HighlightedCodeProps {
  language?: string;
  code: string;
  isDark: boolean;
}

const LazyHighlightedCode = lazy(async () => {
  const [
    { default: SyntaxHighlighter },
    { default: oneDark },
    { default: oneLight },
  ] = await Promise.all([
    import("react-syntax-highlighter/dist/esm/prism-async-light"),
    import("react-syntax-highlighter/dist/esm/styles/prism/one-dark"),
    import("react-syntax-highlighter/dist/esm/styles/prism/one-light"),
  ]);

  return {
    default({ language, code, isDark }: HighlightedCodeProps) {
      return (
        <SyntaxHighlighter
          language={language}
          style={isDark ? oneDark : oneLight}
          customStyle={{
            margin: 0,
            padding: "1rem",
            fontSize: "0.8125rem",
            lineHeight: 1.6,
            background: "transparent",
          }}
          PreTag="pre"
          wrapLongLines
        >
          {code}
        </SyntaxHighlighter>
      );
    },
  };
});

function PlainCodeFallback({ code }: { code: string }) {
  return (
    <pre className="m-0 overflow-x-auto whitespace-pre-wrap p-4 font-mono text-[0.8125rem] leading-[1.6]">
      <code>{code}</code>
    </pre>
  );
}

function useIsDark() {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

export function CodeBlock({
  language,
  code,
  className,
  highlight = true,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const isDark = useIsDark();

  const onCopy = useCallback(() => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    });
  }, [code]);

  return (
    <div
      className={`overflow-hidden rounded-lg border border-border ${className || ""}`}
    >
      <div className="flex items-center justify-between px-4 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-50 text-text-secondary">
        <span className="lowercase font-mono">{language || "code"}</span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono transition-colors text-text-secondary hover:bg-gray-200 hover:text-text"
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      {highlight ? (
        <Suspense fallback={<PlainCodeFallback code={code} />}>
          <LazyHighlightedCode language={language} code={code} isDark={isDark} />
        </Suspense>
      ) : (
        <PlainCodeFallback code={code} />
      )}
    </div>
  );
}
