/**
 * Markdown normalization utilities inspired by DeepTutor
 * Handles edge cases and improves rendering quality
 */

const ZERO_WIDTH_REGEX = /[​-‍﻿]/g;
const EMPTY_HTML_BLOCK_REGEX = /<(p|div|section|article|aside|blockquote)(?:\s[^>]*)?>\s*(?:&nbsp;|\s|<br\s*\/?>)*\s*<\/\1>/gi;

/**
 * Remove invisible zero-width characters
 */
function stripInvisibleCharacters(value: string): string {
  return value.replace(ZERO_WIDTH_REGEX, "");
}

/**
 * Extract plain text from markdown for analysis
 */
function stripDisplaySyntax(value: string): string {
  return stripInvisibleCharacters(String(value))
    .replace(/&nbsp;/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/!\[(.*?)\]\([^)]+\)/g, "$1")
    .replace(/\[(.*?)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}

/**
 * Split markdown table cells
 */
function splitMarkdownTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  if (!trimmed) return [""];
  return trimmed.split("|");
}

/**
 * Check if line is a markdown table separator (e.g., |---|---|)
 */
function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const cells = splitMarkdownTableCells(trimmed);
  return (
    cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  );
}

/**
 * Check if current line starts a markdown table
 */
function isMarkdownTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false;

  const header = lines[index]?.trim() || "";
  const separator = lines[index + 1]?.trim() || "";
  if (
    !header ||
    !separator ||
    !header.includes("|") ||
    !isMarkdownTableSeparator(separator)
  ) {
    return false;
  }

  return (
    splitMarkdownTableCells(header).length ===
    splitMarkdownTableCells(separator).length
  );
}

/**
 * Check if line is a table body row
 */
function isMarkdownTableBodyRow(line: string, columnCount: number): boolean {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes("|")) return false;
  return splitMarkdownTableCells(trimmed).length === columnCount;
}

/**
 * Check if table is empty (all cells are empty)
 */
function isEmptyMarkdownTable(lines: string[]): boolean {
  return lines
    .filter((_, index) => index !== 1) // Skip separator row
    .every((line) =>
      splitMarkdownTableCells(line).every(
        (cell) => stripDisplaySyntax(cell).length === 0,
      ),
    );
}

/**
 * Remove empty markdown tables
 */
function removeEmptyMarkdownTables(content: string): string {
  const lines = content.split("\n");
  const cleaned: string[] = [];

  for (let index = 0; index < lines.length; ) {
    if (!isMarkdownTableStart(lines, index)) {
      cleaned.push(lines[index]);
      index += 1;
      continue;
    }

    const columnCount = splitMarkdownTableCells(lines[index]).length;
    let end = index + 2;
    while (
      end < lines.length &&
      isMarkdownTableBodyRow(lines[end], columnCount)
    ) {
      end += 1;
    }

    const tableLines = lines.slice(index, end);
    if (!isEmptyMarkdownTable(tableLines)) {
      cleaned.push(...tableLines);
    }
    index = end;
  }

  return cleaned.join("\n");
}

/**
 * Normalize markdown content for display
 * - Remove invisible characters
 * - Clean up empty HTML blocks
 * - Remove empty tables
 * - Normalize line breaks
 */
export function normalizeMarkdownForDisplay(content: string): string {
  if (!content) return "";

  const normalized = stripInvisibleCharacters(String(content))
    .replace(/\r\n/g, "\n")
    .replace(EMPTY_HTML_BLOCK_REGEX, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");

  const cleaned = removeEmptyMarkdownTables(normalized).replace(/\n{3,}/g, "\n\n");

  return cleaned;
}

/**
 * Check if markdown content has visible text
 */
export function hasVisibleMarkdownContent(content: string): boolean {
  const normalized = normalizeMarkdownForDisplay(content);
  if (!normalized.trim()) return false;

  const withoutMarkup = normalized
    .replace(/<[^>]+>/g, "")
    .replace(/\[(.*?)\]\([^)]+\)/g, "$1")
    .replace(/!\[(.*?)\]\([^)]+\)/g, "$1")
    .replace(/^[\s>*\-+|#`]+$/gm, "");

  return stripInvisibleCharacters(withoutMarkup).trim().length > 0;
}
