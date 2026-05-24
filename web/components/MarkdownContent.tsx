"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { Scissors } from "lucide-react";

function fixMarkdown(text: string): string {
  let s = text.replace(/\\n/g, "\n");

  // Step 0: Handle || as table row separator
  // Split on || and check if adjacent parts look like table rows
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
        // Ensure prev ends with |
        const prevRstrip = prev.trimEnd();
        if (prevRstrip.endsWith("|")) {
          merged[merged.length - 1] = prev;
        } else {
          merged[merged.length - 1] = prevRstrip + "|";
        }
        // Ensure part starts with |
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

    // Split text glued to table: "text| col | col |" → "text\n| col | col |"
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

    // Table separator row: |---|---|---| or bare ------ ------
    const isTableSep = /^\|[\s\-:|]+\|$/.test(trimmed) || /^-{2,}(\s+-{2,})*$/.test(trimmed);
    // Table data/header row (starts and ends with |)
    const isTableRow = /^\|.+\|$/.test(trimmed);

    if (isTableSep || isTableRow) {
      // Normalize bare separator: "------ ------" → "|---|---|"
      if (isTableSep && !trimmed.startsWith("|")) {
        const cols = trimmed.split(/\s+/).filter(Boolean).length;
        result.push("|" + Array(Math.max(cols, 1)).fill("---").join("|") + "|");
      } else {
        result.push(line);
      }
      continue;
    }

    // Insert newline before list items glued to text
    let processed = line;
    processed = processed.replace(/([^\n\s])- /g, "$1\n- ");
    processed = processed.replace(/([^\n\s])-([^\s*\-|a-zA-Z])/g, "$1\n- $2");
    processed = processed.replace(/([^\n\s])(\d+\.)([^\s\d])/g, "$1\n$2 $3");
    result.push(processed);
  }
  s = result.join("\n");

  // Step 4: Insert separator row once — find first header→data transition
  const sLines = s.split("\n");
  const final: string[] = [];
  let sepInserted = false;
  for (let i = 0; i < sLines.length; i++) {
    final.push(sLines[i]);
    if (!sepInserted && i + 1 < sLines.length) {
      const curr = sLines[i].trim();
      const nxt = sLines[i + 1].trim();
      const currIsSep = /^\|[\s\-:|]+\|$/.test(curr);
      const nxtIsSep = /^\|[\s\-:|]+\|$/.test(nxt);
      const currIsRow = /^\|.+\|$/.test(curr);
      const nxtIsRow = /^\|.+\|$/.test(nxt);
      if (currIsRow && nxtIsRow && !currIsSep && !nxtIsSep) {
        const cols = (curr.match(/\|/g) || []).length - 1;
        if (cols >= 1) {
          final.push("|" + Array(cols).fill("---").join("|") + "|");
          sepInserted = true;
        }
      }
    }
  }
  s = final.join("\n");

  // Step 5: Convert space-separated rows within table regions
  // Expands from separator rows to find the full table and converts all rows
  const tLines = s.split("\n");
  const toConvert = new Set<number>();
  for (let i = 0; i < tLines.length; i++) {
    const trimmed = tLines[i].trim();
    if (!/^\|[\s\-:|]+\|$/.test(trimmed)) continue;
    // Found a separator row. Expand table region upward.
    for (let j = i - 1; j >= 0; j--) {
      const prev = tLines[j].trim();
      if (/^\|.+\|$/.test(prev) || /\S{2,}\s{2,}\S/.test(prev)) {
        if (!/^\|.+\|$/.test(prev)) toConvert.add(j);
      } else break;
    }
    // Expand table region downward.
    for (let j = i + 1; j < tLines.length; j++) {
      const nxt = tLines[j].trim();
      if (/^\|.+\|$/.test(nxt) || /\S{2,}\s{2,}\S/.test(nxt)) {
        if (!/^\|.+\|$/.test(nxt)) toConvert.add(j);
      } else break;
    }
  }
  const converted: string[] = [];
  for (let i = 0; i < tLines.length; i++) {
    if (toConvert.has(i)) {
      const cells = tLines[i].trim().split(/\s{2,}/).filter(Boolean);
      converted.push(cells.length >= 2 ? "| " + cells.join(" | ") + " |" : tLines[i]);
    } else {
      converted.push(tLines[i]);
    }
  }
  s = converted.join("\n");

  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

const PROSE_CLASSES =
  "prose prose-sm max-w-none break-words prose-headings:font-semibold prose-headings:mb-1.5 prose-headings:mt-2.5 prose-h1:text-base prose-h2:text-[15px] prose-h3:text-sm prose-p:my-1.5 prose-p:text-[13px] prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-li:text-[13px] prose-hr:my-3 prose-pre:bg-gray-100 prose-pre:text-text prose-code:text-primary-dark prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-blockquote:border-l-primary prose-blockquote:pl-3 prose-blockquote:italic prose-table:text-[13px] prose-th:px-2.5 prose-th:py-1.5 prose-th:font-semibold prose-td:px-2.5 prose-td:py-1.5";

function splitIntoBlocks(text: string): string[] {
  const fixed = fixMarkdown(text);
  const blocks = fixed.split(/\n{2,}/);
  const merged: string[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const isListItem = /^(\d+\.|[-*+])\s/.test(trimmed);
    const isTable = /^\|.*\|/.test(trimmed);
    const prevIsList = merged.length > 0 && /^(\d+\.|[-*+])\s/m.test(merged[merged.length - 1]);
    const prevIsTable = merged.length > 0 && /^\|.*\|/m.test(merged[merged.length - 1]);
    if ((isListItem && prevIsList) || (isTable && prevIsTable)) {
      merged[merged.length - 1] += "\n\n" + trimmed;
    } else {
      merged.push(trimmed);
    }
  }
  return merged;
}

interface MarkdownContentProps {
  content: string;
  onPrecipitateBlock?: (text: string) => void;
}

export function MarkdownContent({ content, onPrecipitateBlock }: MarkdownContentProps) {
  const fixed = useMemo(() => fixMarkdown(content), [content]);

  if (!onPrecipitateBlock) {
    return (
      <div className={PROSE_CLASSES}>
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
          {fixed}
        </ReactMarkdown>
      </div>
    );
  }

  const blocks = splitIntoBlocks(content);
  if (blocks.length <= 1) {
    return (
      <div className={PROSE_CLASSES}>
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
          {fixed}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {blocks.map((block, i) => (
        <div key={i} className="group relative">
          <div className={PROSE_CLASSES}>
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
              {block}
            </ReactMarkdown>
          </div>
          <button
            onClick={() => onPrecipitateBlock(block)}
            className="absolute -right-1 -top-1 z-10 hidden items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] text-text-secondary shadow-sm transition hover:border-primary hover:text-primary-dark group-hover:flex"
            title="沉淀此段为卡片"
          >
            <Scissors size={10} />
            沉淀
          </button>
        </div>
      ))}
    </div>
  );
}
