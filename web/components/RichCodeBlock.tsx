"use client";

import React from "react";

interface RichCodeBlockProps {
  raw: string;
  lang?: string;
  className?: string;
}

export default function RichCodeBlock({ raw, lang, className }: RichCodeBlockProps) {
  return (
    <pre className={`overflow-x-auto rounded-lg bg-muted p-4 text-sm ${className || ""}`}>
      <code className={`language-${lang || "text"}`}>{raw}</code>
    </pre>
  );
}
