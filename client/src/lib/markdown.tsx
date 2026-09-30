/**
 * Tiny in-house Markdown renderer for briefs: headings, bullet/numbered lists, paragraphs,
 * blockquotes, fenced code, rules; inline bold/italic/code/links. Emits React elements — no HTML injection.
 */
import { Fragment, type ReactNode } from "react";

const LIST_RE = /^\s*(?:[-*•]|\d+[.)])\s+/;
const ORDERED_RE = /^\s*\d+[.)]\s+/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const RULE_RE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;

function isBlockStart(line: string): boolean {
  return HEADING_RE.test(line) || LIST_RE.test(line) || RULE_RE.test(line) || line.startsWith(">") || line.startsWith("```");
}

const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\b_[^_\s][^_]*_\b)|\[([^\]]+)\]\(((?:https?:\/\/|mailto:|\/)[^\s)]*)\)|(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g;

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const [whole, code, bold, italic, italic2, linkText, linkHref, bareUrl] = m;
    if (code) out.push(<code key={key++}>{code.slice(1, -1)}</code>);
    else if (bold) out.push(<strong key={key++}>{renderInline(bold.slice(2, -2))}</strong>);
    else if (italic) out.push(<em key={key++}>{renderInline(italic.slice(1, -1))}</em>);
    else if (italic2) out.push(<em key={key++}>{renderInline(italic2.slice(1, -1))}</em>);
    else if (linkText && linkHref)
      out.push(
        <a key={key++} href={linkHref} target="_blank" rel="noreferrer noopener" className="text-brand underline">
          {linkText}
        </a>,
      );
    else if (bareUrl)
      out.push(
        <a key={key++} href={bareUrl} target="_blank" rel="noreferrer noopener" className="break-all text-brand underline">
          {bareUrl}
        </a>,
      );
    else out.push(whole);
    last = start + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const at = (n: number): string => lines[n] ?? "";

  while (i < lines.length) {
    const line = at(i);
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading && heading[1] !== undefined) {
      const level = Math.min(heading[1].length, 6);
      const content = renderInline(heading[2] ?? "");
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      out.push(<Tag key={key++}>{content}</Tag>);
      i++;
      continue;
    }
    if (RULE_RE.test(line)) {
      out.push(<hr key={key++} />);
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
      out.push(
        <pre key={key++}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && at(i).startsWith(">")) {
        quote.push(at(i).replace(/^>\s?/, ""));
        i++;
      }
      out.push(<blockquote key={key++}>{renderMarkdown(quote.join("\n"))}</blockquote>);
      continue;
    }
    if (LIST_RE.test(line)) {
      const ordered = ORDERED_RE.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && LIST_RE.test(at(i))) {
        let content = at(i).replace(LIST_RE, "");
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(at(i)) && !LIST_RE.test(at(i))) {
          content += ` ${at(i).trim()}`;
          i++;
        }
        items.push(<li key={items.length}>{renderInline(content)}</li>);
      }
      out.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && at(i).trim() && !isBlockStart(at(i))) {
      para.push(at(i).trim());
      i++;
    }
    out.push(
      <p key={key++}>
        {para.map((p, idx) => (
          <Fragment key={idx}>
            {idx > 0 && " "}
            {renderInline(p)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return out;
}

export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  return <div className={`md text-sm leading-relaxed text-slate-800 ${className}`}>{renderMarkdown(source)}</div>;
}
