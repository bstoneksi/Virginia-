/**
 * Minimal RFC 4180 CSV reader for the importer: quoted fields, doubled quotes, embedded newlines,
 * CR / LF / CRLF line ends, a UTF-8 BOM and delimiter auto-detection (comma, semicolon, tab, pipe).
 * Returns a dense 2-D array of raw strings; fully empty trailing rows are dropped.
 */

const DELIMITERS = [",", ";", "\t", "|"] as const;

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === delimiter) count++;
  }
  return count;
}

/** The delimiter that splits the first non-empty line into the most fields (comma wins ties). */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\r|\n/).find((l) => l.trim().length > 0) ?? "";
  let best: string = ",";
  let bestCount = countOutsideQuotes(firstLine, ",");
  for (const d of DELIMITERS) {
    const n = countOutsideQuotes(firstLine, d);
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const sep = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quotedField = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.length === 0 && !quotedField) {
      inQuotes = true;
      quotedField = true;
      continue;
    }
    if (ch === sep) {
      row.push(field);
      field = "";
      quotedField = false;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text.charAt(i + 1) === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      quotedField = false;
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || quotedField || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last !== undefined && last.every((f) => f.trim().length === 0)) rows.pop();
    else break;
  }
  return rows;
}
