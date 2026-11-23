import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("returns empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });

  it("escapes HTML special characters", () => {
    const result = renderMarkdown("<b>hello</b> & world");
    expect(result).toContain("&lt;b&gt;");
    expect(result).toContain("&amp;");
    expect(result).toContain("&lt;/b&gt;");
  });

  it("renders **bold** as <strong>", () => {
    const result = renderMarkdown("**bold text**");
    expect(result).toContain("<strong>bold text</strong>");
  });

  it("renders *italic* as <em>", () => {
    const result = renderMarkdown("*italic text*");
    expect(result).toContain("<em>italic text</em>");
  });

  it("renders __bold__ as <strong>", () => {
    const result = renderMarkdown("__bold__");
    expect(result).toContain("<strong>bold</strong>");
  });

  it("renders _italic_ as <em>", () => {
    const result = renderMarkdown("_italic_");
    expect(result).toContain("<em>italic</em>");
  });

  it("renders [text](url) as anchor with target=_blank", () => {
    const result = renderMarkdown("[Click here](https://example.com)");
    expect(result).toContain('<a href="https://example.com"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain("Click here");
  });

  it("escapes quotes so a link URL cannot break out of href", () => {
    const result = renderMarkdown('[x](https://a" onmouseover="alert(1))');
    expect(result).not.toContain('" onmouseover="');
    expect(result).toContain("&quot;");
  });

  it("does not turn javascript: or data: URLs into links", () => {
    expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain("<a ");
    expect(renderMarkdown("[x](JaVaScRiPt:alert(1))")).not.toContain("<a ");
    expect(renderMarkdown("[x](data:text/html,hi)")).not.toContain("<a ");
  });

  it("keeps mailto: links", () => {
    expect(renderMarkdown("[mail](mailto:a@b.co)")).toContain('<a href="mailto:a@b.co"');
  });

  it("renders list items with - prefix inside <ul>", () => {
    const result = renderMarkdown("- item one\n- item two");
    expect(result).toContain("<ul");
    expect(result).toContain("<li>item one</li>");
    expect(result).toContain("<li>item two</li>");
    expect(result).toContain("</ul>");
  });

  it("closes list when non-list content follows", () => {
    const result = renderMarkdown("- item\nnormal line");
    expect(result).toContain("</ul>");
    expect(result).toContain("normal line");
  });

  it("preserves newlines (does not convert to <br>)", () => {
    // The main branch renderMarkdown joins lines with \n, not <br>
    const result = renderMarkdown("line one\nline two");
    expect(result).toContain("line one");
    expect(result).toContain("line two");
    expect(result).not.toContain("<br>");
  });

  it("strips empty lines (trimmed to empty string becomes empty in output)", () => {
    const result = renderMarkdown("line one\n\nline two");
    // Empty line returns "" (not <br>) in the map; lines are joined with \n
    expect(result).toContain("line one");
    expect(result).toContain("line two");
  });
});
