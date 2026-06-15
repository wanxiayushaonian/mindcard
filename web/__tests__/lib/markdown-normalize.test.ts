import { describe, it, expect } from "vitest";
import {
  normalizeMarkdownForDisplay,
  hasVisibleMarkdownContent,
} from "@/lib/markdown-normalize";

describe("markdown-normalize: normalizeMarkdownForDisplay", () => {
  it("returns empty string for empty input", () => {
    expect(normalizeMarkdownForDisplay("")).toBe("");
  });

  it("fixes heading without space", () => {
    expect(normalizeMarkdownForDisplay("##标题")).toContain("## 标题");
  });

  it("fixes list item without space", () => {
    expect(normalizeMarkdownForDisplay("-项目")).toContain("- 项目");
  });

  it("adds blank line before heading without space", () => {
    const result = normalizeMarkdownForDisplay("text\n##标题");
    expect(result).toContain("text\n\n## 标题");
  });

  it("adds blank line after heading without space", () => {
    const result = normalizeMarkdownForDisplay("##标题\ntext");
    expect(result).toContain("## 标题\n\ntext");
  });

  it("removes empty HTML blocks", () => {
    expect(normalizeMarkdownForDisplay("<div></div>")).toBe("");
  });

  it("removes empty markdown tables", () => {
    const input = "| | |\n|---|---|\n| | |";
    expect(normalizeMarkdownForDisplay(input)).toBe("");
  });

  it("preserves non-empty tables", () => {
    const input = "| Name |\n|---|\n| Alice |";
    expect(normalizeMarkdownForDisplay(input)).toContain("Alice");
  });

  it("collapses multiple blank lines", () => {
    const result = normalizeMarkdownForDisplay("a\n\n\n\nb");
    expect(result).not.toMatch(/\n{3,}/);
  });
});

describe("markdown-normalize: hasVisibleMarkdownContent", () => {
  it("returns false for empty string", () => {
    expect(hasVisibleMarkdownContent("")).toBe(false);
  });

  it("returns false for whitespace only", () => {
    expect(hasVisibleMarkdownContent("  \n  ")).toBe(false);
  });

  it("returns true for plain text", () => {
    expect(hasVisibleMarkdownContent("hello world")).toBe(true);
  });

  it("returns false for markup-only content", () => {
    expect(hasVisibleMarkdownContent("---")).toBe(false);
  });
});
