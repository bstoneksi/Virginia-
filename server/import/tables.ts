/**
 * Table detection over a sheet grid (docs/SPEC.md §7).
 *
 * A "table" is a run of contiguous header cells on one row that contains a Note column and at least
 * one other known column (Date, Division, Owner/Target | WHO, Priority, Due Date, Status, …). Header
 * matching is case- and punctuation-insensitive. Several tables may sit side by side on the same row
 * (the Brain Dump has four) or stacked below each other. The table name is the nearest title-like
 * cell above the Date header (within 3 rows), otherwise the sheet name.
 *
 * Grids are format-agnostic so the same code serves ExcelJS worksheets (server/import/excel.ts) and
 * hand-parsed CSV (server/import/csv.ts).
 */

export type HeaderKey = "date" | "note" | "division" | "owner" | "priority" | "due" | "status" | "category" | "initiative" | "context";

export interface CellData {
  /** Trimmed display text ("" for empty). Dates render as YYYY-MM-DD. */
  text: string;
  /** Typed value when the source had one (Excel dates / numbers); the raw string for CSV. */
  value: string | number | boolean | Date | null;
}

export interface SheetGrid {
  name: string;
  /** row → column → cell; 1-based; only cells with content. */
  cells: Map<number, Map<number, CellData>>;
  rowCount: number;
  colCount: number;
}

export interface DetectedTable {
  sheet: string;
  name: string;
  headerRow: number;
  firstCol: number;
  lastCol: number;
  /** Column number of each recognised header. */
  columns: Partial<Record<HeaderKey, number>>;
  /** Original header text for every column in the run (unknown headers included). */
  labels: Map<number, string>;
}

export interface TableRow {
  rowNumber: number;
  cells: Partial<Record<HeaderKey, CellData>>;
  /** Header label → cell text, for the preview's raw view. */
  raw: Record<string, string>;
}

const HEADER_SYNONYMS: Record<HeaderKey, readonly string[]> = {
  date: ["date", "dateadded", "added", "created", "createddate", "datecreated", "entered", "dateentered", "logged", "captured"],
  note: ["note", "notes", "item", "items", "description", "desc", "task", "tasks", "todo", "todos", "actionitem", "detail", "details", "summary", "text", "subject", "title", "topic"],
  division: ["division", "divisions", "brand", "brands", "div", "company", "businessunit", "bu", "entity", "business"],
  owner: ["owner", "owners", "ownertarget", "target", "who", "assignedto", "assigned", "assignee", "person", "responsible"],
  priority: ["priority", "pri", "prio", "importance", "urgency"],
  due: ["duedate", "due", "deadline", "dueby", "needby", "targetdate"],
  status: ["status", "state", "progress", "stage"],
  category: ["category", "cat", "type", "tag", "kind"],
  initiative: ["initiative", "project", "program", "rollup"],
  context: ["context", "meeting", "source"],
};

const HEADER_LOOKUP: ReadonlyMap<string, HeaderKey> = new Map(
  (Object.entries(HEADER_SYNONYMS) as [HeaderKey, readonly string[]][]).flatMap(([key, names]) =>
    names.map((n): [string, HeaderKey] => [n, key]),
  ),
);

/** How many rows above the header row may hold the table title. */
export const TITLE_LOOKBACK = 3;

/** Lowercase with everything but letters and digits removed: "Owner / Target" → "ownertarget". */
export function normalizeHeader(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function headerKey(text: string): HeaderKey | undefined {
  return HEADER_LOOKUP.get(normalizeHeader(text));
}

// ---------------------------------------------------------------------------
// Grid construction
// ---------------------------------------------------------------------------

export function createGrid(name: string): SheetGrid {
  return { name, cells: new Map(), rowCount: 0, colCount: 0 };
}

/** Store a cell; cells without display text are ignored. */
export function setCell(grid: SheetGrid, row: number, col: number, data: CellData): void {
  if (data.text.length === 0) return;
  let r = grid.cells.get(row);
  if (!r) {
    r = new Map();
    grid.cells.set(row, r);
  }
  r.set(col, data);
  if (row > grid.rowCount) grid.rowCount = row;
  if (col > grid.colCount) grid.colCount = col;
}

export function getCell(grid: SheetGrid, row: number, col: number): CellData | undefined {
  return grid.cells.get(row)?.get(col);
}

/** Build a grid from a dense matrix (CSV rows, tests). Strings become text cells; blanks are skipped. */
export function gridFromMatrix(name: string, matrix: readonly (readonly (CellData | string | null | undefined)[])[]): SheetGrid {
  const grid = createGrid(name);
  matrix.forEach((row, rIdx) => {
    row.forEach((cell, cIdx) => {
      if (cell === null || cell === undefined) return;
      const data: CellData = typeof cell === "string" ? { text: cell.trim(), value: cell } : cell;
      setCell(grid, rIdx + 1, cIdx + 1, data);
    });
  });
  return grid;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

interface HeaderRun {
  lastCol: number;
  columns: Partial<Record<HeaderKey, number>>;
  labels: Map<number, string>;
}

/** Walk right from `startCol` over contiguous non-empty cells until a blank or a repeated header key. */
function readHeaderRun(rowCells: ReadonlyMap<number, CellData>, startCol: number): HeaderRun {
  const columns: Partial<Record<HeaderKey, number>> = {};
  const labels = new Map<number, string>();
  let col = startCol;
  for (;;) {
    const cell = rowCells.get(col);
    if (!cell || cell.text.length === 0) break;
    const key = headerKey(cell.text);
    if (key !== undefined && columns[key] !== undefined) break; // the next table starts here
    if (key !== undefined) columns[key] = col;
    labels.set(col, cell.text);
    col++;
  }
  return { lastCol: col - 1, columns, labels };
}

function looksLikeTitle(cell: CellData): boolean {
  if (typeof cell.value !== "string") return false;
  const text = cell.text;
  if (text.length === 0 || text.length > 80) return false;
  if (headerKey(text) !== undefined) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) || /^\d+([./-]\d+)*$/.test(text)) return false;
  return true;
}

/**
 * The nearest title above the table: a sparse row (at most two distinct texts within the table's
 * columns, so data rows of a table stacked above are not mistaken for a title) whose cell above the
 * Date header — or, failing that, its leftmost title-like cell — is short text.
 */
function findTitle(grid: SheetGrid, table: DetectedTable): string | undefined {
  const anchorCol = table.columns.date ?? table.firstCol;
  for (let k = 1; k <= TITLE_LOOKBACK; k++) {
    const row = table.headerRow - k;
    if (row < 1) break;
    const rowCells = grid.cells.get(row);
    if (!rowCells) continue;
    const distinct = new Set<string>();
    for (let col = table.firstCol; col <= table.lastCol; col++) {
      const text = rowCells.get(col)?.text ?? "";
      if (text.length > 0) distinct.add(text);
    }
    if (distinct.size === 0) continue;
    if (distinct.size > 2) return undefined; // a dense row above: data of another table, no title here
    const anchor = rowCells.get(anchorCol);
    if (anchor && looksLikeTitle(anchor)) return anchor.text;
    for (let col = table.firstCol; col <= table.lastCol; col++) {
      const cell = rowCells.get(col);
      if (cell && looksLikeTitle(cell)) return cell.text;
    }
    return undefined;
  }
  return undefined;
}

/** Find every table header row in the grid, left to right, top to bottom. Names are unique per sheet. */
export function detectTables(grid: SheetGrid): DetectedTable[] {
  const tables: DetectedTable[] = [];
  const rowNumbers = [...grid.cells.keys()].sort((a, b) => a - b);
  for (const r of rowNumbers) {
    const rowCells = grid.cells.get(r);
    if (!rowCells) continue;
    const cols = [...rowCells.keys()].sort((a, b) => a - b);
    let idx = 0;
    while (idx < cols.length) {
      const startCol = cols[idx];
      if (startCol === undefined) break;
      if (headerKey(rowCells.get(startCol)?.text ?? "") === undefined) {
        idx++;
        continue;
      }
      const run = readHeaderRun(rowCells, startCol);
      if (run.columns.note !== undefined && Object.keys(run.columns).length >= 2) {
        tables.push({ sheet: grid.name, name: "", headerRow: r, firstCol: startCol, lastCol: run.lastCol, columns: run.columns, labels: run.labels });
        while (idx < cols.length) {
          const c = cols[idx];
          if (c === undefined || c > run.lastCol) break;
          idx++;
        }
      } else {
        idx++;
      }
    }
  }

  const used = new Map<string, number>();
  for (const table of tables) {
    const base = findTitle(grid, table) ?? grid.name;
    const n = (used.get(base.toLowerCase()) ?? 0) + 1;
    used.set(base.toLowerCase(), n);
    table.name = n === 1 ? base : `${base} (${n})`;
  }
  return tables;
}

// ---------------------------------------------------------------------------
// Row extraction
// ---------------------------------------------------------------------------

function isHeaderRow(rowCells: ReadonlyMap<number, CellData>, table: DetectedTable): number {
  let hits = 0;
  for (const [key, col] of Object.entries(table.columns) as [HeaderKey, number][]) {
    if (headerKey(rowCells.get(col)?.text ?? "") === key) hits++;
  }
  return hits;
}

function uniqueLabel(raw: Record<string, string>, label: string): string {
  if (!(label in raw)) return label;
  for (let n = 2; ; n++) {
    const candidate = `${label} (${n})`;
    if (!(candidate in raw)) return candidate;
  }
}

/**
 * The data rows of a table: every row below the header (until the header of another table that
 * overlaps these columns) that has a Note. Blank rows, rows without a Note, repeated header rows and
 * merged banner rows (the same text across the whole span) are skipped.
 */
export function extractRows(grid: SheetGrid, table: DetectedTable, allTables: readonly DetectedTable[] = [table]): TableRow[] {
  const noteCol = table.columns.note;
  if (noteCol === undefined) return [];
  let endRow = grid.rowCount;
  for (const other of allTables) {
    if (other === table || other.sheet !== table.sheet || other.headerRow <= table.headerRow) continue;
    if (other.lastCol < table.firstCol || other.firstCol > table.lastCol) continue;
    endRow = Math.min(endRow, other.headerRow - 1);
  }

  const rows: TableRow[] = [];
  for (let r = table.headerRow + 1; r <= endRow; r++) {
    const rowCells = grid.cells.get(r);
    if (!rowCells) continue;
    const texts: string[] = [];
    for (let c = table.firstCol; c <= table.lastCol; c++) {
      const t = rowCells.get(c)?.text ?? "";
      if (t.length > 0) texts.push(t);
    }
    if (texts.length === 0) continue;
    if (texts.length >= 2 && texts.every((t) => t === texts[0])) continue; // merged banner / title row
    const note = rowCells.get(noteCol);
    if (!note || note.text.length === 0) continue;
    if (isHeaderRow(rowCells, table) >= 2) continue;

    const cells: Partial<Record<HeaderKey, CellData>> = {};
    for (const [key, col] of Object.entries(table.columns) as [HeaderKey, number][]) {
      const cell = rowCells.get(col);
      if (cell) cells[key] = cell;
    }
    const raw: Record<string, string> = {};
    for (const [col, label] of table.labels) raw[uniqueLabel(raw, label)] = rowCells.get(col)?.text ?? "";
    rows.push({ rowNumber: r, cells, raw });
  }
  return rows;
}
