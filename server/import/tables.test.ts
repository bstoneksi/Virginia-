import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectTables, extractRows, gridFromMatrix, headerKey, normalizeHeader } from "./tables";

const HEADERS = ["Date", "Note", "Division", "Owner/Target", "Priority", "Due Date", "Status"];

describe("headerKey", () => {
  it("is case-, space- and punctuation-insensitive and knows the Brain Dump synonyms", () => {
    assert.equal(normalizeHeader(" Owner / Target "), "ownertarget");
    assert.equal(headerKey("Owner/Target"), "owner");
    assert.equal(headerKey("WHO"), "owner");
    assert.equal(headerKey("Owner"), "owner");
    assert.equal(headerKey("Due Date"), "due");
    assert.equal(headerKey(" due "), "due");
    assert.equal(headerKey("DATE"), "date");
    assert.equal(headerKey("Notes"), "note");
    assert.equal(headerKey("Div."), "division");
    assert.equal(headerKey("Brand"), "division");
    assert.equal(headerKey("Priority"), "priority");
    assert.equal(headerKey("Status"), "status");
    assert.equal(headerKey("Category"), "category");
    assert.equal(headerKey("Comments"), undefined);
    assert.equal(headerKey(""), undefined);
  });
});

describe("detectTables", () => {
  it("finds two side-by-side tables with a blank separator column and names them from the title above Date", () => {
    const grid = gridFromMatrix("Brain Dump", [
      [],
      ["New Business", null, null, null, null, null, null, null, "Parking Lot"],
      [...HEADERS, null, "Date", "Note", "Division", "WHO", "Priority", "Due", "Status"],
      ["9/12/2026", "Pitch the glass package", "HG", "VM", "High", "10/15/2026", "Not Started", null, "9/1/2026", "Consolidate leases?", "FOB", "AG", "Low", "", ""],
      ["9/13/2026", "Second NB row", "APP", "MN", "", "", "In Progress", null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null, "9/2/2026", "Rebrand the trucks", "PF", "", "low", "", "Not Started"],
    ]);
    const tables = detectTables(grid);
    assert.deepEqual(
      tables.map((t) => ({ name: t.name, headerRow: t.headerRow, firstCol: t.firstCol, lastCol: t.lastCol })),
      [
        { name: "New Business", headerRow: 3, firstCol: 1, lastCol: 7 },
        { name: "Parking Lot", headerRow: 3, firstCol: 9, lastCol: 15 },
      ],
    );
    const [nb, pl] = tables;
    assert.ok(nb && pl);
    assert.deepEqual(nb.columns, { date: 1, note: 2, division: 3, owner: 4, priority: 5, due: 6, status: 7 });
    assert.equal(pl.columns.owner, 12);
    assert.deepEqual(extractRows(grid, nb, tables).map((r) => r.rowNumber), [4, 5]);
    const plRows = extractRows(grid, pl, tables);
    assert.deepEqual(plRows.map((r) => r.rowNumber), [4, 6]);
    assert.deepEqual(plRows[0]?.raw, { Date: "9/1/2026", Note: "Consolidate leases?", Division: "FOB", WHO: "AG", Priority: "Low", Due: "", Status: "" });
    assert.equal(plRows[1]?.cells.owner, undefined);
    assert.equal(plRows[1]?.cells.status?.text, "Not Started");
  });

  it("splits side-by-side tables that touch (no separator column) at the repeated header", () => {
    const grid = gridFromMatrix("Sheet1", [
      ["Date", "Note", "Owner", "Status", "Date", "Note", "Owner", "Status"],
      ["1/1/2026", "left", "VM", "Open", "1/2/2026", "right", "SB", "Open"],
    ]);
    const tables = detectTables(grid);
    assert.deepEqual(
      tables.map((t) => [t.name, t.firstCol, t.lastCol]),
      [
        ["Sheet1", 1, 4],
        ["Sheet1 (2)", 5, 8],
      ],
    );
  });

  it("handles stacked tables: rows stop at the next header and titles are picked up when within 3 rows", () => {
    const grid = gridFromMatrix("Dump", [
      ["Action Items"],
      HEADERS,
      ["9/1/2026", "First action", "HG", "VM", "", "", ""],
      ["9/2/2026", "Second action", "", "", "", "", ""],
      [],
      ["Watch List"],
      [],
      HEADERS,
      ["9/3/2026", "Keep an eye on margins", "RF", "SB", "", "", ""],
      [],
      ["Far Away Title"],
      [],
      [],
      [],
      HEADERS,
      ["9/4/2026", "Untitled table row", "", "", "", "", ""],
    ]);
    const tables = detectTables(grid);
    assert.deepEqual(
      tables.map((t) => [t.name, t.headerRow]),
      [
        ["Action Items", 2],
        ["Watch List", 8],
        ["Dump", 15],
      ],
    );
    const [actions, watch, third] = tables;
    assert.ok(actions && watch && third);
    assert.deepEqual(extractRows(grid, actions, tables).map((r) => r.cells.note?.text), ["First action", "Second action"]);
    assert.deepEqual(extractRows(grid, watch, tables).map((r) => r.cells.note?.text), ["Keep an eye on margins"]);
    assert.deepEqual(extractRows(grid, third, tables).map((r) => r.cells.note?.text), ["Untitled table row"]);
  });

  it("skips blank rows, rows without a note, merged banner rows and repeated header rows", () => {
    const grid = gridFromMatrix("S", [
      HEADERS,
      ["9/1/2026", "", "HG", "", "", "", ""],
      ["Banner", "Banner", "Banner", "Banner", "Banner", "Banner", "Banner"],
      [],
      HEADERS,
      ["9/2/2026", "Real row", "", "", "", "", ""],
    ]);
    const tables = detectTables(grid);
    // The repeated header is detected as its own table; the first table's rows end before it.
    assert.equal(tables.length, 2);
    const first = tables[0];
    assert.ok(first);
    assert.deepEqual(extractRows(grid, first, tables), []);
    const second = tables[1];
    assert.ok(second);
    assert.deepEqual(extractRows(grid, second, tables).map((r) => r.rowNumber), [6]);
  });

  it("ignores rows that merely contain a header word and requires a Note plus one companion column", () => {
    const grid = gridFromMatrix("S", [
      ["Date", "Something"],
      ["Note"],
      ["Status", "Note"],
    ]);
    const tables = detectTables(grid);
    assert.deepEqual(
      tables.map((t) => [t.headerRow, t.columns]),
      [[3, { status: 1, note: 2 }]],
    );
  });
});
