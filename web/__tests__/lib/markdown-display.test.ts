import { describe, it, expect } from "vitest";
import {
  normalizeMarkdownForDisplay,
  escapeUnknownHtmlTagsForDisplay,
  hasVisibleMarkdownContent,
} from "@/lib/markdown-display";

describe("normalizeMarkdownForDisplay", () => {
  it("returns empty string for empty input", () => {
    expect(normalizeMarkdownForDisplay("")).toBe("");
  });

  it("adds space after heading markers", () => {
    expect(normalizeMarkdownForDisplay("##标题")).toContain("## 标题");
  });

  it("adds space after list markers", () => {
    expect(normalizeMarkdownForDisplay("-项目")).toContain("- 项目");
  });

  it("removes zero-width characters", () => {
    expect(normalizeMarkdownForDisplay("hello​world")).toBe("helloworld");
  });

  it("removes empty details blocks", () => {
    expect(normalizeMarkdownForDisplay("<details></details>")).toBe("");
  });

  it("removes empty HTML tables", () => {
    const input = '<table><tr><td></td></tr></table>';
    expect(normalizeMarkdownForDisplay(input)).toBe("");
  });

  it("removes empty markdown tables", () => {
    const input = "| | |\n|---|---|\n| | |";
    expect(normalizeMarkdownForDisplay(input)).toBe("");
  });

  it("preserves non-empty markdown tables", () => {
    const input = "| Name | Value |\n|---|---|\n| foo | bar |";
    const result = normalizeMarkdownForDisplay(input);
    expect(result).toContain("foo");
    expect(result).toContain("bar");
  });

  it("escapes unknown HTML tags", () => {
    const result = normalizeMarkdownForDisplay("<think>hello</think>");
    expect(result).toContain("`<think>`");
  });

  it("preserves allowed HTML tags", () => {
    const result = normalizeMarkdownForDisplay("<strong>bold</strong>");
    expect(result).toContain("<strong>");
  });

  it("normalizes \\r\\n to \\n", () => {
    expect(normalizeMarkdownForDisplay("a\r\nb")).toBe("a\nb");
  });

  it("collapses multiple blank lines", () => {
    const result = normalizeMarkdownForDisplay("a\n\n\n\nb");
    expect(result).not.toMatch(/\n{3,}/);
  });

  it("fixes AI heading spacing", () => {
    const result = normalizeMarkdownForDisplay("text\n## 标题\nmore");
    expect(result).toContain("\n\n## 标题\n\n");
  });
});

describe("escapeUnknownHtmlTagsForDisplay", () => {
  it("returns empty string for empty input", () => {
    expect(escapeUnknownHtmlTagsForDisplay("")).toBe("");
  });

  it("preserves allowed HTML tags", () => {
    expect(escapeUnknownHtmlTagsForDisplay("<div>ok</div>")).toContain("<div>");
  });

  it("escapes unknown tags into backticks", () => {
    const result = escapeUnknownHtmlTagsForDisplay("<foo>bar</foo>");
    expect(result).toContain("`<foo>`");
  });

  it("preserves tags inside fenced code blocks", () => {
    const input = "```html\n<div><custom></div>\n```";
    const result = escapeUnknownHtmlTagsForDisplay(input);
    // Code blocks are protected — tags inside should not be escaped
    expect(result).toContain("<custom>");
  });

  it("preserves tags inside inline code", () => {
    const input = "`<custom>`";
    const result = escapeUnknownHtmlTagsForDisplay(input);
    expect(result).toContain("<custom>");
  });

  it("removes zero-width characters", () => {
    expect(escapeUnknownHtmlTagsForDisplay("a​b")).toBe("ab");
  });
});

describe("hasVisibleMarkdownContent", () => {
  it("returns false for empty string", () => {
    expect(hasVisibleMarkdownContent("")).toBe(false);
  });

  it("returns false for whitespace only", () => {
    expect(hasVisibleMarkdownContent("   \n  ")).toBe(false);
  });

  it("returns true for text content", () => {
    expect(hasVisibleMarkdownContent("hello")).toBe(true);
  });

  it("returns false for empty fenced code block", () => {
    expect(hasVisibleMarkdownContent("```\n```")).toBe(false);
  });

  it("returns true for code block with content", () => {
    expect(hasVisibleMarkdownContent("```\ncode\n```")).toBe(true);
  });

  it("returns false for comment-only content", () => {
    expect(hasVisibleMarkdownContent("<!-- comment -->")).toBe(false);
  });
});
