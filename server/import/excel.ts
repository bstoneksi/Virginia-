/**
 * server/import/excel.ts — parse an uploaded .xlsx / .xlsm workbook or a .csv into an ImportPreview
 * (docs/SPEC.md §7). ExcelJS reads workbooks (xlsx and xlsm are the same zip format); CSV is parsed by
 * hand (server/import/csv.ts). Table detection lives in tables.ts and the row → ItemDraft mapping in
 * mapping.ts, so both are unit-testable without a workbook.
 *
 * Wire into the app as `createApp({ ..., parseImportFile })`; the /api/import/preview route calls it.
 */
import ExcelJS from "exceljs";
import type { CellValue, Workbook, Worksheet } from "exceljs";
import type { ImportPreview, ImportRow } from "../../shared/types";
import type { ExtractContext, ImportFile, ParseImportFileFn, ParseImportOptions } from "../contracts";
import { todayISO } from "../db/index";
import { ValidationError } from "../lib/errors";
import { parseCsv } from "./csv";
import { buildImportRow, isoFromDate } from "./mapping";
import { createGrid, detectTables, extractRows, gridFromMatrix, setCell } from "./tables";
import type { CellData, SheetGrid } from "./tables";

const WORKBOOK_EXTENSIONS: ReadonlySet<string> = new Set(["xlsx", "xlsm", "xltx", "xltm"]);
const CSV_EXTENSIONS: ReadonlySet<string> = new Set(["csv", "tsv", "txt"]);

type FileKind = "workbook" | "csv" | "xls" | "unknown";

function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function stemOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).trim() || "Sheet1";
}

/** Zip magic → workbook, OLE magic → legacy .xls, else by extension. */
export function sniffFileKind(bytes: Uint8Array, filename: string): FileKind {
  const ext = extensionOf(filename);
  const b0 = bytes[0], b1 = bytes[1], b2 = bytes[2], b3 = bytes[3];
  if (b0 === 0x50 && b1 === 0x4b && (b2 === 0x03 || b2 === 0x05 || b2 === 0x07)) return "workbook";
  if (b0 === 0xd0 && b1 === 0xcf && b2 === 0x11 && b3 === 0xe0) return "xls";
  if (WORKBOOK_EXTENSIONS.has(ext)) return "workbook";
  if (CSV_EXTENSIONS.has(ext) || ext.length === 0) return "csv";
  return "unknown";
}

// ---------------------------------------------------------------------------
// ExcelJS → grid
// ---------------------------------------------------------------------------

/** Display text + typed value for any ExcelJS cell value (rich text, hyperlinks and formula results included). */
export function cellDataFromValue(value: CellValue): CellData {
  if (value === null || value === undefined) return { text: "", value: null };
  if (value instanceof Date) return { text: isoFromDate(value) ?? "", value };
  if (typeof value === "number") return { text: Number.isFinite(value) ? String(value) : "", value };
  if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE", value };
  if (typeof value === "string") return { text: value.trim(), value };
  if ("richText" in value) {
    const text = value.richText.map((part) => part.text).join("").trim();
    return { text, value: text };
  }
  if ("hyperlink" in value) {
    const label: unknown = value.text;
    if (typeof label === "string") return { text: label.trim(), value: label };
    if (label !== null && typeof label === "object" && "richText" in label) return cellDataFromValue(label as CellValue);
    return { text: value.hyperlink.trim(), value: value.hyperlink };
  }
  if ("formula" in value || "sharedFormula" in value) return cellDataFromValue(value.result ?? null);
  return { text: "", value: null }; // #N/A and friends
}

export function gridFromWorksheet(ws: Worksheet): SheetGrid {
  const grid = createGrid(ws.name);
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      // Merged slave cells report their master's value, so a banner merged across a table shows
      // up above every column — including the Date header the title lookup anchors on.
      setCell(grid, rowNumber, colNumber, cellDataFromValue(cell.value));
    });
  });
  return grid;
}

/** ExcelJS types its own `Buffer` (an empty ArrayBuffer extension); at runtime it wants a Node Buffer. */
type ExcelBuffer = Parameters<Workbook["xlsx"]["load"]>[0];

function toExcelBuffer(bytes: Uint8Array): ExcelBuffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as unknown as ExcelBuffer;
}

export async function gridsFromWorkbook(bytes: Uint8Array): Promise<SheetGrid[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(toExcelBuffer(bytes));
  } catch (err) {
    throw new ValidationError(`Could not read the workbook: ${err instanceof Error ? err.message : String(err)}`);
  }
  return workbook.worksheets.map(gridFromWorksheet);
}

// ---------------------------------------------------------------------------
// CSV → grid
// ---------------------------------------------------------------------------

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

export function gridFromCsvText(name: string, text: string): SheetGrid {
  return gridFromMatrix(name, parseCsv(text));
}

// ---------------------------------------------------------------------------
// Preview assembly
// ---------------------------------------------------------------------------

export function previewFromGrids(filename: string, grids: readonly SheetGrid[], ctx: ExtractContext, today: string): ImportPreview {
  const rows: ImportRow[] = [];
  const detectedTables: string[] = [];
  for (const grid of grids) {
    const tables = detectTables(grid);
    for (const table of tables) {
      if (!detectedTables.includes(table.name)) detectedTables.push(table.name);
      for (const row of extractRows(grid, table, tables)) rows.push(buildImportRow(row, table, ctx, today));
    }
  }
  return { filename, sheetNames: grids.map((g) => g.name), detectedTables, rows };
}

/** ParseImportFileFn for server/app.ts: `.xlsx` / `.xlsm` via ExcelJS, `.csv` by hand; 422 for anything else. */
export const parseImportFile: ParseImportFileFn = async (file: ImportFile, ctx: ExtractContext, options: ParseImportOptions = {}): Promise<ImportPreview> => {
  const filename = file.filename.trim() || "import";
  const bytes = file.bytes;
  if (bytes.byteLength === 0) throw new ValidationError("The uploaded file is empty");
  const today = options.todayISO ?? todayISO();
  switch (sniffFileKind(bytes, filename)) {
    case "workbook":
      return previewFromGrids(filename, await gridsFromWorkbook(bytes), ctx, today);
    case "csv":
      return previewFromGrids(filename, [gridFromCsvText(stemOf(filename), decodeText(bytes))], ctx, today);
    case "xls":
      throw new ValidationError("Legacy .xls (Excel 97-2003) workbooks are not supported — save it as .xlsx or .xlsm first");
    default: {
      const ext = extensionOf(filename);
      throw new ValidationError(`Unsupported file type ${ext ? `.${ext}` : `"${filename}"`} — upload a .xlsx, .xlsm or .csv file`);
    }
  }
};
