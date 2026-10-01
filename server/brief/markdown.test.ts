import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeHtml, markdownToPlainText, renderMarkdownHtml, stripInline } from "./markdown";

describe("renderMarkdownHtml", () => {
  it("renders headings, inline marks, lists with continuation lines, quotes, fenced code and rules", () => {
    const html = renderMarkdownHtml(
      "# Title\n\nSome **bold** and *it* and `code`.\n\n## Two\n- one\n  continued\n- two\n\n1. first\n2) second\n\n> quoted\n> line\n\n```\nraw <x>\n```\n\n---\n",
    );
    assert.ok(html.includes("<h1>Title</h1>"));
    assert.ok(html.includes("<p>Some <strong>bold</strong> and <em>it</em> and <code>code</code>.</p>"));
    assert.ok(html.includes("<h2>Two</h2>"));
    assert.ok(html.includes("<ul><li>one continued</li><li>two</li></ul>"));
    assert.ok(html.includes("<ol><li>first</li><li>second</li></ol>"));
    assert.ok(html.includes("<blockquote><p>quoted line</p></blockquote>"));
    assert.ok(html.includes("<pre><code>raw &lt;x&gt;</code></pre>"));
    assert.ok(html.includes("<hr>"));
  });

  it("escapes every character from the source and only links to http(s), mailto and relative targets", () => {
    const html = renderMarkdownHtml("<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://a.b/c?d=1&e=2) https://bare.example/x \"q\" 's'");
    assert.ok(!html.includes("<script"));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(!html.includes('href="javascript:'));
    assert.ok(html.includes('<a href="https://a.b/c?d=1&amp;e=2">ok</a>'));
    assert.ok(html.includes('<a href="https://bare.example/x">https://bare.example/x</a>'));
    assert.ok(html.includes("&quot;q&quot;"));
    assert.ok(html.includes("&#39;s&#39;"));
  });

  it("adds inline styles per tag when asked (email clients ignore <style>)", () => {
    const html = renderMarkdownHtml("## H\n- a", { styles: { h2: "color:red", li: 'margin:0;font-family:"x"' } });
    assert.ok(html.includes('<h2 style="color:red">H</h2>'));
    assert.ok(html.includes('<ul><li style="margin:0;font-family:&quot;x&quot;">a</li></ul>'));
  });

  it("renders an empty string to nothing", () => {
    assert.equal(renderMarkdownHtml(""), "");
    assert.equal(renderMarkdownHtml("\n\n  \n"), "");
  });
});

describe("markdownToPlainText", () => {
  it("strips markup, underlines h1 / h2, keeps bullets, numbering, quotes and link targets", () => {
    const text = markdownToPlainText(
      "# Daily brief\n\nHello **Brandon**, see [the board](https://v.example/board) and `x`.\n\n## Overdue (1)\n- *Late* thing — VM\n  more\n\n## Empty\nNothing.\n\n> note\n\n---\n1. one",
    );
    const lines = text.split("\n");
    assert.equal(lines[0], "Daily brief");
    assert.equal(lines[1], "===========");
    assert.ok(text.includes("Hello Brandon, see the board (https://v.example/board) and x."));
    assert.ok(text.includes("Overdue (1)\n-----------\n\n- Late thing — VM more"));
    assert.ok(text.includes("\nNothing.\n"));
    assert.ok(text.includes("> note"));
    assert.ok(text.includes("----------"));
    assert.ok(text.endsWith("1. one"));
    assert.ok(!text.includes("**"));
    assert.ok(!/\n{3,}/.test(text), "never more than one blank line in a row");
  });

  it("stripInline / escapeHtml behave on plain and special text", () => {
    assert.equal(stripInline("a — b · c"), "a — b · c");
    assert.equal(stripInline("[same](https://x.y)"), "same (https://x.y)");
    assert.equal(stripInline("[https://x.y](https://x.y)"), "https://x.y");
    assert.equal(escapeHtml("&<>\"'"), "&amp;&lt;&gt;&quot;&#39;");
  });
});
