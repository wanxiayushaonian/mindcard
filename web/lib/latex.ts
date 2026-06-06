/**
 * Pre-process markdown content before rendering.
 *
 * - Expands `[TOC]` into a placeholder
 * - Converts `flow`/`seq` code fences into mermaid blocks
 * - Converts inline `\(...\)` to `$...$` and `\[...\]` to `$$...$$`
 * - Collapses runs of 3+ blank lines
 */
export function processMarkdownContent(content: string): string {
  let result = content;

  // Expand [TOC] marker
  result = result.replace(/\[TOC\]/gi, "\n<!-- TABLE_OF_CONTENTS -->\n");

  // Convert ```flow / ```seq fences into ```mermaid
  result = result.replace(
    /```(?:flow|seq)\s*\n([\s\S]*?)```/g,
    (_match, body: string) => "```mermaid\n" + body.trim() + "\n```"
  );

  // Convert \( inline math \) to $ ... $
  result = result.replace(
    /\\\((.+?)\\\)/g,
    (_match, math: string) => `$${math}$`
  );

  // Convert \[ block math \] to $$ ... $$
  result = result.replace(
    /\\\[([\s\S]*?)\\\]/g,
    (_match, math: string) => `$$\n${math.trim()}\n$$`
  );

  // Collapse runs of 3+ blank lines to 2
  result = result.replace(/\n{3,}/g, "\n\n");

  return result;
}
