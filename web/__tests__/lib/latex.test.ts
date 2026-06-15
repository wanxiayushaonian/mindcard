import { describe, it, expect } from "vitest";
import { processMarkdownContent } from "@/lib/latex";

describe("processMarkdownContent", () => {
  it("converts [TOC] to HTML comment placeholder", () => {
    expect(processMarkdownContent("[TOC]")).toContain("<!-- TABLE_OF_CONTENTS -->");
  });

  it("converts [TOC] case-insensitively", () => {
    expect(processMarkdownContent("[toc]")).toContain("<!-- TABLE_OF_CONTENTS -->");
    expect(processMarkdownContent("[Toc]")).toContain("<!-- TABLE_OF_CONTENTS -->");
  });

  it("converts flow code fence to mermaid", () => {
    const input = "```flow\nA -> B\n```";
    const result = processMarkdownContent(input);
    expect(result).toContain("```mermaid");
    expect(result).not.toContain("```flow");
  });

  it("converts seq code fence to mermaid", () => {
    const input = "```seq\nA -> B\n```";
    const result = processMarkdownContent(input);
    expect(result).toContain("```mermaid");
    expect(result).not.toContain("```seq");
  });

  it("does not convert other code fences", () => {
    const input = "```python\nprint('hi')\n```";
    expect(processMarkdownContent(input)).toBe(input);
  });

  it("converts inline \\(...\\) to $...$", () => {
    expect(processMarkdownContent("\\(x^2\\)")).toBe("$x^2$");
  });

  it("converts block \\[...\\] to $$...$$", () => {
    const input = "\\[x^2 + y^2\\]";
    const result = processMarkdownContent(input);
    expect(result).toContain("$$");
    expect(result).toContain("x^2 + y^2");
  });

  it("collapses 3+ blank lines to 2", () => {
    expect(processMarkdownContent("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("preserves exactly 2 blank lines", () => {
    expect(processMarkdownContent("a\n\nb")).toBe("a\n\nb");
  });
});
