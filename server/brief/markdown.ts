/**
 * server/brief/markdown.ts — a small, safe Markdown renderer for the daily brief's email.
 *
 * Server-side twin of client/src/lib/markdown.tsx with the same grammar: headings, bullet / numbered
 * lists (indented continuation lines join the item), paragraphs, blockquotes, fenced code, rules;
 * inline bold / italic / code / links / bare URLs. Instead of React elements it emits an HTML string
 * (every character that came from the source is escaped, link targets are limited to http(s), mailto
 * and site-relative paths — so a brief that quotes an email digest can never inject markup) and a
 * plain-text rendering for the email's text part. No packages.
 */

const LIST_RE = /^\s*(?:[-*•]|\d+[.)])\s+/;
const ORDERED_RE = /^\s*\d+[.)]\s+/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const RULE_RE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;

const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\b_[^_\s][^_]*_\b)|\[([^\]]+)\]\(((?:https?:\/\/|mailto:|\/)[^\s)]*)\)|(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g;

export type HtmlTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "ul" | "ol" | "li" | "blockquote" | "pre" | "code" | "hr" | "a" | "strong" | "em";

/** Optional `style="…"` attribute per tag — email clients ignore <style> blocks, so styles go inline. */
export type InlineStyles = Partial<Record<HtmlTag, string>>;

export interface RenderOptions {
  styles?: InlineStyles;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function isBlockStart(line: string): boolean {
  return HEADING_RE.test(line) || LIST_RE.test(line) || RULE_RE.test(line) || line.startsWith(">") || line.startsWith("```");
}

function splitLines(source: string): string[] {
  return source.replace(/\r\n?/g, "\n").split("\n");
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

class HtmlWriter {
  constructor(private readonly styles: InlineStyles) {}

  open(tag: HtmlTag, attrs = ""): string {
    const style = this.styles[tag];
    return `<${tag}${attrs}${style ? ` style="${escapeHtml(style)}"` : ""}>`;
  }

  wrap(tag: HtmlTag, inner: string, attrs = ""): string {
    return `${this.open(tag, attrs)}${inner}</${tag}>`;
  }

  inline(text: string): string {
    let out = "";
    let last = 0;
    for (const m of text.matchAll(INLINE_RE)) {
      const start = m.index ?? 0;
      if (start > last) out += escapeHtml(text.slice(last, start));
      const [whole, code, bold, italic, italic2, linkText, linkHref, bareUrl] = m;
      if (code) out += this.wrap("code", escapeHtml(code.slice(1, -1)));
      else if (bold) out += this.wrap("strong", this.inline(bold.slice(2, -2)));
      else if (italic) out += this.wrap("em", this.inline(italic.slice(1, -1)));
      else if (italic2) out += this.wrap("em", this.inline(italic2.slice(1, -1)));
      else if (linkText && linkHref) out += this.wrap("a", this.inline(linkText), ` href="${escapeHtml(linkHref)}"`);
      else if (bareUrl) out += this.wrap("a", escapeHtml(bareUrl), ` href="${escapeHtml(bareUrl)}"`);
      else out += escapeHtml(whole);
      last = start + whole.length;
    }
    if (last < text.length) out += escapeHtml(text.slice(last));
    return out;
  }

  blocks(source: string): string {
    const lines = splitLines(source);
    const out: string[] = [];
    let i = 0;
    const at = (n: number): string => lines[n] ?? "";

    while (i < lines.length) {
      const line = at(i);
      if (!line.trim()) {
        i++;
        continue;
      }
      const heading = HEADING_RE.exec(line);
      if (heading && heading[1] !== undefined) {
        const tag = `h${Math.min(heading[1].length, 6)}` as HtmlTag;
        out.push(this.wrap(tag, this.inline(heading[2] ?? "")));
        i++;
        continue;
      }
      if (RULE_RE.test(line)) {
        out.push(this.open("hr"));
        i++;
        continue;
      }
      if (line.startsWith("```")) {
        const code: string[] = [];
        i++;
        while (i < lines.length && !at(i).startsWith("```")) {
          code.push(at(i));
          i++;
        }
        i++;
        out.push(this.wrap("pre", this.wrap("code", escapeHtml(code.join("\n")))));
        continue;
      }
      if (line.startsWith(">")) {
        const quote: string[] = [];
        while (i < lines.length && at(i).startsWith(">")) {
          quote.push(at(i).replace(/^>\s?/, ""));
          i++;
        }
        out.push(this.wrap("blockquote", this.blocks(quote.join("\n"))));
        continue;
      }
      if (LIST_RE.test(line)) {
        const ordered = ORDERED_RE.test(line);
        const items: string[] = [];
        while (i < lines.length && LIST_RE.test(at(i))) {
          let content = at(i).replace(LIST_RE, "");
          i++;
          while (i < lines.length && /^\s{2,}\S/.test(at(i)) && !LIST_RE.test(at(i))) {
            content += ` ${at(i).trim()}`;
            i++;
          }
          items.push(this.wrap("li", this.inline(content)));
        }
        out.push(this.wrap(ordered ? "ol" : "ul", items.join("")));
        continue;
      }
      const para: string[] = [];
      while (i < lines.length && at(i).trim() && !isBlockStart(at(i))) {
        para.push(at(i).trim());
        i++;
      }
      out.push(this.wrap("p", para.map((p) => this.inline(p)).join(" ")));
    }
    return out.join("\n");
  }
}

/** Render Markdown to an HTML fragment (no <html>/<body>); all source text is escaped. */
export function renderMarkdownHtml(source: string, options: RenderOptions = {}): string {
  return new HtmlWriter(options.styles ?? {}).blocks(source);
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

/** Drop inline markup: `code` → code, **bold** / *italic* → text, [text](href) → text (href). */
export function stripInline(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const start = m.index ?? 0;
    if (start > last) out += text.slice(last, start);
    const [whole, code, bold, italic, italic2, linkText, linkHref, bareUrl] = m;
    if (code) out += code.slice(1, -1);
    else if (bold) out += stripInline(bold.slice(2, -2));
    else if (italic) out += stripInline(italic.slice(1, -1));
    else if (italic2) out += stripInline(italic2.slice(1, -1));
    else if (linkText && linkHref) out += linkHref === linkText ? linkText : `${stripInline(linkText)} (${linkHref})`;
    else if (bareUrl) out += bareUrl;
    else out += whole;
    last = start + whole.length;
  }
  if (last < text.length) out += text.slice(last);
  return out;
}

/**
 * Plain-text rendering for the email's text part: headings keep their text (level 1 underlined with
 * `=`, level 2 with `-`), list items keep their indentation with a `-` bullet (numbers are kept),
 * paragraphs are joined, blockquotes keep `> `, fenced code is indented, rules become a dashed line.
 */
export function markdownToPlainText(source: string): string {
  const lines = splitLines(source);
  const out: string[] = [];
  let i = 0;
  const at = (n: number): string => lines[n] ?? "";
  const blank = (): void => {
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
  };

  while (i < lines.length) {
    const line = at(i);
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading && heading[1] !== undefined) {
      const text = stripInline(heading[2] ?? "").trim();
      blank();
      out.push(text);
      if (heading[1].length === 1) out.push("=".repeat(Math.max(3, text.length)));
      else if (heading[1].length === 2) out.push("-".repeat(Math.max(3, text.length)));
      out.push("");
      i++;
      continue;
    }
    if (RULE_RE.test(line)) {
      blank();
      out.push("----------");
      out.push("");
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      blank();
      i++;
      while (i < lines.length && !at(i).startsWith("```")) {
        out.push(`    ${at(i)}`);
        i++;
      }
      i++;
      out.push("");
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && at(i).startsWith(">")) {
        quote.push(at(i).replace(/^>\s?/, ""));
        i++;
      }
      blank();
      for (const q of markdownToPlainText(quote.join("\n")).split("\n")) out.push(q.length > 0 ? `> ${q}` : ">");
      out.push("");
      continue;
    }
    if (LIST_RE.test(line)) {
      while (i < lines.length && LIST_RE.test(at(i))) {
        const raw = at(i);
        const indent = raw.match(/^\s*/)?.[0] ?? "";
        const marker = ORDERED_RE.test(raw) ? (raw.match(/^\s*(\d+[.)])/)?.[1] ?? "-") : "-";
        let content = raw.replace(LIST_RE, "");
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(at(i)) && !LIST_RE.test(at(i))) {
          content += ` ${at(i).trim()}`;
          i++;
        }
        out.push(`${indent}${marker} ${stripInline(content)}`);
      }
      out.push("");
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && at(i).trim() && !isBlockStart(at(i))) {
      para.push(stripInline(at(i).trim()));
      i++;
    }
    out.push(para.join(" "));
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
