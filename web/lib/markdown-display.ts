"use client";

const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF]/g;
const EMPTY_DETAILS_REGEX =
  /<details(?:\s[^>]*)?>\s*(<summary(?:\s[^>]*)?>\s*(?:&nbsp;|\s|<br\s*\/?>)*\s*<\/summary>\s*)?<\/details>/gi;
const EMPTY_SUMMARY_REGEX =
  /<summary(?:\s[^>]*)?>\s*(?:&nbsp;|\s|<br\s*\/?>)*\s*<\/summary>/gi;
const EMPTY_PROGRESS_REGEX =
  /<progress(?:\s[^>]*)?>\s*(?:&nbsp;|\s|<br\s*\/?>)*\s*<\/progress>/gi;
const RAW_INPUT_REGEX = /<input(?:\s[^>]*)?>/gi;
const EMPTY_FORM_CONTROL_REGEX =
  /<(textarea|select|button|meter)(?:\s[^>]*)?>\s*(?:&nbsp;|\s|<br\s*\/?>)*\s*<\/\1>/gi;
const EMPTY_FENCED_CODE_BLOCK_REGEX = /```[^\n`]*\n?\s*```/g;
const EMPTY_HTML_BLOCK_REGEX =
  /<(p|div|section|article|aside|blockquote)(?:\s[^>]*)?>\s*(?:&nbsp;|\s|<br\s*\/?>)*\s*<\/\1>/gi;
const HTML_TABLE_REGEX = /<table(?:\s[^>]*)?>[\s\S]*?<\/table>/gi;

function stripInvisibleCharacters(value: string): string {
  return value.replace(ZERO_WIDTH_REGEX, "");
}

// Tags that the renderer (rehype-raw + react-markdown) is allowed to render
// as actual HTML/SVG/MathML elements. Any other `<word>` looking token
// (e.g. LLM-pseudo-tags like <mem>, <think>, <tool_call>, <answer>, <search>)
// is escaped into inline code so the browser does not warn about unknown
// custom elements with lowercase names.
const ALLOWED_HTML_TAGS = new Set<string>([
  // structural
  "p",
  "div",
  "span",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "main",
  "nav",
  "address",
  "dialog",
  // text-level
  "a",
  "em",
  "strong",
  "b",
  "i",
  "u",
  "s",
  "del",
  "ins",
  "small",
  "sub",
  "sup",
  "mark",
  "kbd",
  "code",
  "samp",
  "var",
  "q",
  "cite",
  "abbr",
  "time",
  "wbr",
  "ruby",
  "rt",
  "rp",
  "bdi",
  "bdo",
  // line-level
  "br",
  "hr",
  // lists
  "ol",
  "ul",
  "li",
  "dl",
  "dt",
  "dd",
  // headings
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  // block quotes / pre
  "blockquote",
  "pre",
  "figure",
  "figcaption",
  // tables
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "col",
  "colgroup",
  // media
  "img",
  "video",
  "audio",
  "source",
  "picture",
  "track",
  "iframe",
  "canvas",
  "embed",
  "object",
  "param",
  "map",
  "area",
  // disclosure / forms (we keep these even if they are usually stripped)
  "details",
  "summary",
  "progress",
  "meter",
  "input",
  "textarea",
  "select",
  "button",
  "label",
  "fieldset",
  "legend",
  "form",
  "option",
  "optgroup",
  "datalist",
  "output",
  // svg
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "use",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "marker",
  "pattern",
  "mask",
  "clippath",
  "symbol",
  "title",
  "desc",
  "foreignobject",
  // mathml
  "math",
  "mi",
  "mn",
  "mo",
  "ms",
  "mtext",
  "mrow",
  "mfrac",
  "msup",
  "msub",
  "msubsup",
  "munder",
  "mover",
  "munderover",
  "mroot",
  "msqrt",
  "menclose",
  "mspace",
  "mtable",
  "mtr",
  "mtd",
]);

const HTML_LIKE_TAG_REGEX = /<\/?([A-Za-z][A-Za-z0-9_-]*)\b[^<>]*?\/?>/g;
const FENCED_CODE_BLOCK_REGEX = /```[\s\S]*?```/g;
const INLINE_CODE_SPAN_REGEX = /`[^`\n]*`/g;
const PROTECTED_SPAN_REGEX = /```[\s\S]*?```|`[^`\n]*`/g;
const PROTECTED_PLACEHOLDER_REGEX = /\u0000PROTECTED_(\d+)\u0000/g;

function escapeUnknownHtmlTags(content: string): string {
  if (!content || (!content.includes("<") && !content.includes(">"))) {
    return content;
  }
  const protectedSpans: string[] = [];
  const masked = content.replace(PROTECTED_SPAN_REGEX, (match) => {
    protectedSpans.push(match);
    return `\u0000PROTECTED_${protectedSpans.length - 1}\u0000`;
  });
  const escaped = masked.replace(HTML_LIKE_TAG_REGEX, (match, name: string) => {
    const lower = String(name).toLowerCase();
    if (ALLOWED_HTML_TAGS.has(lower)) return match;
    // Already wrapped in backticks (would happen if the source already
    // protected a similar token earlier in the string).
    return `\`${match}\``;
  });
  return escaped.replace(
    PROTECTED_PLACEHOLDER_REGEX,
    (_, idx: string) => protectedSpans[Number(idx)] ?? "",
  );
}

export function escapeUnknownHtmlTagsForDisplay(content: string): string {
  if (!content) return "";
  return escapeUnknownHtmlTags(
    stripInvisibleCharacters(String(content)).replace(/\r\n/g, "\n"),
  );
}

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

function splitMarkdownTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  if (!trimmed) return [""];
  return trimmed.split("|");
}

function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const cells = splitMarkdownTableCells(trimmed);
  return (
    cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  );
}

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

function isMarkdownTableBodyRow(line: string, columnCount: number): boolean {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes("|")) return false;
  return splitMarkdownTableCells(trimmed).length === columnCount;
}

function isEmptyMarkdownTable(lines: string[]): boolean {
  return lines
    .filter((_, index) => index !== 1)
    .every((line) =>
      splitMarkdownTableCells(line).every(
        (cell) => stripDisplaySyntax(cell).length === 0,
      ),
    );
}

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

function removeEmptyHtmlTables(content: string): string {
  return content.replace(HTML_TABLE_REGEX, (block) =>
    stripDisplaySyntax(block) ? block : "",
  );
}

const PREFIXED_CIT = String.raw`(?:web|rag|code|src)-\d+`;
const NUMERIC_CIT = String.raw`\d+`;
const SINGLE_CIT = `(?:${PREFIXED_CIT}|${NUMERIC_CIT})`;
const MULTI_CIT = `${SINGLE_CIT}(?:\\s*,\\s*${SINGLE_CIT})*`;

const INLINE_CITATION_REGEX = new RegExp(
  String.raw`(?<!\*\*|\[)\[(${MULTI_CIT})\](?!\(|:)`,
  "g",
);

const ESCAPED_CITATION_LINK_REGEX = new RegExp(
  String.raw`\\?\[(${SINGLE_CIT})\\?\]\s*\(#references\s+["` +
    "\u201c" +
    String.raw`]citation["` +
    "\u201d" +
    String.raw`]\)`,
  "g",
);

function unwrapBacktickedCitations(content: string): string {
  return content.replace(
    new RegExp(
      "`(\\[" +
        MULTI_CIT +
        '\\](?:\\s*\\(#references\\s+["\\u201c]citation["\\u201d]\\))?)`',
      "g",
    ),
    "$1",
  );
}

function linkifyCitations(content: string): string {
  const refSectionIdx = content.search(/^##\s+(References|参考文献)/m);
  const body = refSectionIdx >= 0 ? content.slice(0, refSectionIdx) : content;
  const tail = refSectionIdx >= 0 ? content.slice(refSectionIdx) : "";

  // Normalize existing citation links that may have escaped brackets or smart quotes
  let linked = body.replace(
    ESCAPED_CITATION_LINK_REGEX,
    (_match, id: string) => `[${id.trim()}](#references "citation")`,
  );

  // Convert bare [web-1] / [rag-1] / [1] / [1, 3] references to a single citation link
  linked = linked.replace(INLINE_CITATION_REGEX, (_match, refs: string) => {
    return `[${refs.trim()}](#references "citation")`;
  });

  // Handle escaped bare citations like \[web-1\] or \[1\] that linkifyCitations missed
  linked = linked.replace(
    new RegExp(String.raw`\\\[(${MULTI_CIT})\\\](?!\s*\()`, "g"),
    (_match, refs: string) => {
      return `[${refs.trim()}](#references "citation")`;
    },
  );

  // Remove stray space before trailing punctuation after citations
  linked = linked.replace(
    /(\(#references\s+"citation"\))\s+([.。,，;:!?])/g,
    "$1$2",
  );

  return linked + tail;
}

function maskProtectedSpans(
  content: string,
  regex: RegExp,
  label: string,
): { masked: string; restore: (value: string) => string } {
  const protectedSpans: string[] = [];
  const masked = content.replace(regex, (match) => {
    protectedSpans.push(match);
    return `\u0000${label}_${protectedSpans.length - 1}\u0000`;
  });
  const placeholderRegex = new RegExp(`\\u0000${label}_(\\d+)\\u0000`, "g");
  return {
    masked,
    restore: (value: string) =>
      value.replace(
        placeholderRegex,
        (_match, idx: string) => protectedSpans[Number(idx)] ?? "",
      ),
  };
}

function linkifyCitationsOutsideCode(content: string): string {
  const fenced = maskProtectedSpans(
    content,
    FENCED_CODE_BLOCK_REGEX,
    "FENCED_CODE",
  );
  const unwrapped = unwrapBacktickedCitations(fenced.masked);
  const inline = maskProtectedSpans(
    unwrapped,
    INLINE_CODE_SPAN_REGEX,
    "INLINE_CODE",
  );
  return fenced.restore(inline.restore(linkifyCitations(inline.masked)));
}

/**
 * Smart markdown formatting: fix common AI output issues without breaking normal text
 * Uses token-based approach instead of regex to avoid splitting words
 */
function smartFormatMarkdown(content: string): string {
  if (!content) return "";

  const lines: string[] = [];
  let currentLine = "";
  let i = 0;

  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];
    const prevChar = i > 0 ? content[i - 1] : "";

    // Check if we're at a heading marker
    if (char === "#" && (i === 0 || prevChar === "\n" || currentLine === "")) {
      // Count consecutive #
      let hashCount = 0;
      let j = i;
      while (j < content.length && content[j] === "#" && hashCount < 6) {
        hashCount++;
        j++;
      }

      // Check if there's content after the hashes
      if (j < content.length && content[j] !== "\n") {
        const hashes = "#".repeat(hashCount);

        // Add blank line before heading if previous line has content
        if (lines.length > 0 && lines[lines.length - 1].trim() !== "") {
          lines.push("");
        }

        // Add space after # if missing
        if (content[j] !== " ") {
          currentLine = hashes + " ";
        } else {
          currentLine = hashes + " ";
          j++; // Skip the existing space
        }

        i = j;
        continue;
      }
    }

    // Check if we're at a list marker
    if (char === "-" && (i === 0 || prevChar === "\n" || currentLine.trim() === "")) {
      // Check if next char is not a space and not a newline (malformed list)
      if (nextChar && nextChar !== " " && nextChar !== "\n" && nextChar !== "-") {
        // Add blank line before list if previous line has content
        if (lines.length > 0 && lines[lines.length - 1].trim() !== "" && !lines[lines.length - 1].startsWith("-")) {
          lines.push("");
        }

        currentLine = "- ";
        i++;
        continue;
      }
    }

    // Handle newlines
    if (char === "\n") {
      const trimmedLine = currentLine.trim();

      // If current line is a heading, ensure blank line after
      if (trimmedLine.match(/^#{1,6}\s/)) {
        lines.push(currentLine);
        // Check if next line is not blank
        if (i + 1 < content.length && content[i + 1] !== "\n") {
          lines.push(""); // Add blank line after heading
        }
        currentLine = "";
        i++;
        continue;
      }

      // If current line is a list item, check if we need blank line after list
      if (trimmedLine.startsWith("-")) {
        lines.push(currentLine);
        // Check if next line is not a list item and not blank
        const nextLineStart = content.substring(i + 1, i + 10);
        if (nextLineStart && !nextLineStart.match(/^\s*-/) && !nextLineStart.match(/^\s*$/)) {
          // Next line is not a list item, add blank line after list
          if (i + 1 < content.length && content[i + 1] !== "\n") {
            lines.push(""); // Add blank line after list
          }
        }
        currentLine = "";
        i++;
        continue;
      }

      lines.push(currentLine);
      currentLine = "";
      i++;
      continue;
    }

    // Regular character
    currentLine += char;
    i++;
  }

  // Don't forget the last line
  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.join("\n");
}

/**
 * Fix common AI markdown formatting issues without breaking normal text
 * Only fixes clear structural issues at line boundaries
 */
function fixAIMarkdownFormatting(content: string): string {
  if (!content) return "";

  let result = content;

  // Fix 1: Add space after heading markers at line start
  // ##标题 -> ## 标题
  result = result.replace(/^(#{1,6})([^\s#])/gm, "$1 $2");

  // Fix 2: Add space after list markers at line start
  // -项目 -> - 项目
  result = result.replace(/^-([^\s-])/gm, "- $1");

  // Fix 3: Ensure blank line before headings (if previous line has content)
  // Split into lines and process
  const lines = result.split("\n");
  const fixed: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prevLine = i > 0 ? lines[i - 1] : "";

    // If this is a heading and previous line has content, add blank line
    if (line.match(/^#{1,6}\s/) && prevLine.trim() !== "") {
      fixed.push("");
    }

    fixed.push(line);

    // If this is a heading and next line has content, add blank line after
    const nextLine = i < lines.length - 1 ? lines[i + 1] : "";
    if (line.match(/^#{1,6}\s/) && nextLine.trim() !== "") {
      fixed.push("");
    }
  }

  return fixed.join("\n");
}

/** Check if a line looks like a markdown structural element (not plain paragraph text). */
function isStructuralLine(line: string): boolean {
  const t = line.trimStart();
  if (!t) return true; // empty line
  if (/^#{1,6}\s/.test(t)) return true; // heading
  if (/^[-*+]\s/.test(t)) return true; // list item
  if (/^\d+\.\s/.test(t)) return true; // ordered list
  if (/^>\s?/.test(t)) return true; // blockquote
  if (/^\|/.test(t)) return true; // table row
  if (/^```/.test(t)) return true; // fenced code
  if (/^---+$/.test(t) || /^\*\*\*+$/.test(t)) return true; // hr
  if (/^<\w/.test(t)) return true; // HTML tag
  return false;
}

/**
 * Ensure blank lines between consecutive paragraph-like lines.
 * LLMs often output paragraphs separated by single newlines, but standard
 * Markdown requires double newlines to create separate <p> elements.
 * Without this fix, all paragraphs collapse into one <p> with <br> breaks,
 * losing the margin that Tailwind's `prose` class applies to <p> elements.
 */
function ensureParagraphSeparation(content: string): string {
  if (!content) return "";
  const lines = content.split("\n");
  const result: string[] = [];
  let inFencedCode = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Track fenced code blocks
    if (/^```/.test(trimmed)) {
      inFencedCode = !inFencedCode;
      result.push(line);
      continue;
    }

    if (inFencedCode) {
      result.push(line);
      continue;
    }

    // If current line is a non-empty paragraph-like line and the previous
    // result line is also a non-empty paragraph-like line, insert a blank line.
    if (trimmed && !isStructuralLine(line)) {
      const prevIdx = result.length - 1;
      if (prevIdx >= 0) {
        const prevLine = result[prevIdx];
        const prevTrimmed = prevLine.trim();
        if (prevTrimmed && !isStructuralLine(prevLine)) {
          // Both current and previous are paragraph text — ensure separation
          result.push(""); // blank line
        }
      }
    }

    result.push(line);
  }

  return result.join("\n");
}

export function normalizeMarkdownForDisplay(content: string): string {
  if (!content) return "";

  // Apply AI formatting fixes first
  const fixed = fixAIMarkdownFormatting(content);

  // Ensure paragraph separation (single \n → \n\n between plain text lines)
  const separated = ensureParagraphSeparation(fixed);

  const normalized = stripInvisibleCharacters(separated)
    .replace(/\r\n/g, "\n")
    .replace(EMPTY_DETAILS_REGEX, "")
    .replace(EMPTY_SUMMARY_REGEX, "")
    .replace(EMPTY_PROGRESS_REGEX, "")
    .replace(RAW_INPUT_REGEX, "")
    .replace(EMPTY_FORM_CONTROL_REGEX, "")
    .replace(EMPTY_HTML_BLOCK_REGEX, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");

  const cleaned = removeEmptyMarkdownTables(
    removeEmptyHtmlTables(normalized),
  ).replace(/\n{3,}/g, "\n\n");
  const safe = escapeUnknownHtmlTagsForDisplay(cleaned);
  return linkifyCitationsOutsideCode(safe);
}

export function hasVisibleMarkdownContent(content: string): boolean {
  const normalized = normalizeMarkdownForDisplay(content);
  if (!normalized.trim()) return false;

  const withoutEmptyBlocks = normalized
    .replace(EMPTY_FENCED_CODE_BLOCK_REGEX, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\[(.*?)\]\([^)]+\)/g, "$1")
    .replace(/!\[(.*?)\]\([^)]+\)/g, "$1")
    .replace(/^[\s>*\-+|#`]+$/gm, "");

  return stripInvisibleCharacters(withoutEmptyBlocks).trim().length > 0;
}
