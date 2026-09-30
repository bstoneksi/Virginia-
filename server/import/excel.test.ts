import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { SEED_DIVISIONS, SEED_PEOPLE } from "../../shared/types";
import type { ImportRow } from "../../shared/types";
import type { ExtractContext } from "../contracts";
import { ValidationError } from "../lib/errors";
import { cellDataFromValue, parseImportFile, sniffFileKind } from "./excel";

const ctx: ExtractContext = {
  divisions: SEED_DIVISIONS,
  people: SEED_PEOPLE.map((p, i) => ({ ...p, id: i + 1 })),
  initiatives: [{ id: 1, name: "BAU", status: "Active", createdAt: "2026-09-30T00:00:00.000Z" }],
};

const SERIAL_2026_10_15 = Math.round((Date.UTC(2026, 9, 15) - Date.UTC(1899, 11, 30)) / 86400000);

/**
 * A Brain Dump lookalike: two side-by-side tables on one sheet, each with a merged title banner two
 * rows above the data, headers on row 3 and three data rows (one blank row inside Parking Lot).
 */
async function brainDumpWorkbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Brain Dump");
  wb.addWorksheet("Log"); // an unrelated empty sheet

  // --- New Business: columns A..G -------------------------------------------------------------
  ws.getCell("A1").value = "New Business";
  ws.mergeCells("A1:G1");
  ["Date", "Note", "Division", "Owner/Target", "Priority", "Due Date", "Status"].forEach((h, i) => {
    ws.getCell(3, i + 1).value = h;
  });
  ws.getCell(4, 1).value = new Date(Date.UTC(2026, 8, 12));
  ws.getCell(4, 2).value = "• Pitch the whole-home glass package to the builder group. Vince has the contact list.";
  ws.getCell(4, 3).value = "Henderson Glass";
  ws.getCell(4, 4).value = "VM";
  ws.getCell(4, 5).value = "High";
  ws.getCell(4, 6).value = new Date(Date.UTC(2026, 9, 15)); // a real Excel date cell
  ws.getCell(4, 6).numFmt = "mm/dd/yyyy";
  ws.getCell(4, 7).value = "Not Started";

  ws.getCell(5, 1).value = "9/13/2026";
  ws.getCell(5, 2).value = { richText: [{ text: "Cabinets Express partnership " }, { text: "intro", font: { bold: true } }] };
  ws.getCell(5, 3).value = "Cabinets Express"; // not a division → warning
  ws.getCell(5, 4).value = "Matt Norton";
  ws.getCell(5, 5).value = "Medium";
  ws.getCell(5, 6).value = "10/20/2026";
  ws.getCell(5, 7).value = "In Progress";

  ws.getCell(6, 2).value = "Quote the countertop install for the Novi subdivision";
  ws.getCell(6, 3).value = "Kitchen & Bath - Install";
  ws.getCell(6, 4).value = "vincent moynihan";
  ws.getCell(6, 6).value = SERIAL_2026_10_15; // unformatted serial
  ws.getCell(6, 7).value = "Complete";

  // --- Parking Lot: columns I..O, older WHO header ---------------------------------------------
  ws.getCell("I1").value = "Parking Lot";
  ws.mergeCells("I1:O1");
  ["Date", "Note", "Division", "WHO", "Priority", "Due", "Status"].forEach((h, i) => {
    ws.getCell(3, 9 + i).value = h;
  });
  ws.getCell(4, 9).value = "9/1/2026";
  ws.getCell(4, 10).value = "Q: Should we consolidate the showroom leases?";
  ws.getCell(4, 11).value = "Corporate";
  ws.getCell(4, 12).value = "AG";
  ws.getCell(4, 13).value = "Low";
  ws.getCell(4, 14).value = "TBD";
  // row 5 intentionally blank in this table
  ws.getCell(6, 10).value = "Someday: rebrand the fence trucks";
  ws.getCell(6, 11).value = "Fence";
  ws.getCell(6, 13).value = "low";
  ws.getCell(6, 15).value = "Not Started";
  ws.getCell(7, 10).value = "Renew the TrueScale software license";
  ws.getCell(7, 11).value = "TrueScale";
  ws.getCell(7, 12).value = "DK / SB";
  ws.getCell(7, 13).value = "Urgent";
  ws.getCell(7, 14).value = "Oct 1, 2026";
  ws.getCell(7, 15).value = "Complete";

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

function byTable(rows: ImportRow[], table: string): ImportRow[] {
  return rows.filter((r) => r.table === table);
}

describe("parseImportFile (xlsx)", () => {
  it("detects both Brain Dump tables and maps their rows", async () => {
    const bytes = await brainDumpWorkbook();
    const preview = await parseImportFile({ filename: "Brandon Runnign Brain Dump.xlsm", bytes }, ctx);

    assert.equal(preview.filename, "Brandon Runnign Brain Dump.xlsm");
    assert.deepEqual(preview.sheetNames, ["Brain Dump", "Log"]);
    assert.deepEqual(preview.detectedTables, ["New Business", "Parking Lot"]);
    assert.equal(preview.rows.length, 6);
    assert.ok(preview.rows.every((r) => r.include && r.sheet === "Brain Dump"));

    const nb = byTable(preview.rows, "New Business");
    assert.deepEqual(nb.map((r) => r.rowNumber), [4, 5, 6]);
    const [nb1, nb2, nb3] = nb;
    assert.ok(nb1 && nb2 && nb3);

    assert.deepEqual(nb1.draft, {
      category: "NB",
      title: "Pitch the whole-home glass package to the builder group",
      note: "• Pitch the whole-home glass package to the builder group. Vince has the contact list.",
      divisionCode: "HG",
      ownerInitials: "VM",
      initiativeName: null,
      priority: "High",
      status: "Open",
      dueDate: "2026-10-15",
      isPersonal: false,
      context: null,
    });
    assert.deepEqual(nb1.warnings, []);
    assert.deepEqual(nb1.raw, {
      Date: "2026-09-12",
      Note: "• Pitch the whole-home glass package to the builder group. Vince has the contact list.",
      Division: "Henderson Glass",
      "Owner/Target": "VM",
      Priority: "High",
      "Due Date": "2026-10-15",
      Status: "Not Started",
    });

    assert.equal(nb2.draft.title, "Cabinets Express partnership intro");
    assert.equal(nb2.draft.divisionCode, null);
    assert.equal(nb2.draft.ownerInitials, "MN");
    assert.equal(nb2.draft.dueDate, "2026-10-20");
    assert.equal(nb2.draft.status, "In Progress");
    assert.deepEqual(nb2.warnings, ["unknown division: Cabinets Express"]);

    assert.equal(nb3.draft.divisionCode, "K&B-I");
    assert.equal(nb3.draft.ownerInitials, "VM");
    assert.equal(nb3.draft.priority, "Medium");
    assert.equal(nb3.draft.dueDate, "2026-10-15");
    assert.equal(nb3.draft.status, "Done");
    assert.deepEqual(nb3.warnings, []);

    const pl = byTable(preview.rows, "Parking Lot");
    assert.deepEqual(pl.map((r) => r.rowNumber), [4, 6, 7]);
    const [pl1, pl2, pl3] = pl;
    assert.ok(pl1 && pl2 && pl3);

    assert.equal(pl1.draft.category, "Q");
    assert.equal(pl1.draft.title, "Should we consolidate the showroom leases?");
    assert.equal(pl1.draft.note, "Q: Should we consolidate the showroom leases?");
    assert.equal(pl1.draft.divisionCode, "FOB");
    assert.equal(pl1.draft.ownerInitials, "AG");
    assert.equal(pl1.draft.priority, "Low");
    assert.equal(pl1.draft.dueDate, null);
    assert.equal(pl1.draft.status, "Parked");
    assert.deepEqual(pl1.warnings, []);
    assert.equal(pl1.raw.WHO, "AG");
    assert.equal(pl1.raw.Due, "TBD");

    assert.equal(pl2.draft.category, "A");
    assert.equal(pl2.draft.title, "Someday: rebrand the fence trucks");
    assert.equal(pl2.draft.divisionCode, "PF");
    assert.equal(pl2.draft.ownerInitials, null);
    assert.equal(pl2.draft.status, "Parked");
    assert.deepEqual(pl2.warnings, []);

    assert.equal(pl3.draft.divisionCode, "TS");
    assert.equal(pl3.draft.ownerInitials, "DK");
    assert.equal(pl3.draft.priority, "High");
    assert.equal(pl3.draft.dueDate, "2026-10-01");
    assert.equal(pl3.draft.status, "Done");
    assert.deepEqual(pl3.warnings, ["multiple owners: used DK, also SB"]);
  });

  it("accepts a plain single-table sheet named after the sheet and ignores archived divisions", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Action Items");
    ws.addRow(["Date", "Note", "Division", "Owner", "Priority", "Due Date", "Status"]);
    ws.addRow([new Date(Date.UTC(2026, 8, 30)), "Send the crew schedule", "HG", "VM", "", "", ""]);
    ws.addRow([]);
    ws.addRow([null, "Follow up on the appliance rebate", "Appliances", "", "High", "10/2", "Not Started"]);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const archived = { ...ctx, divisions: ctx.divisions.map((d) => (d.code === "APP" ? { ...d, archived: true } : d)) };
    const preview = await parseImportFile({ filename: "actions.xlsx", bytes }, archived);
    assert.deepEqual(preview.detectedTables, ["Action Items"]);
    assert.deepEqual(preview.rows.map((r) => [r.rowNumber, r.draft.category, r.draft.title, r.draft.divisionCode]), [
      [2, "A", "Send the crew schedule", "HG"],
      [4, "A", "Follow up on the appliance rebate", null],
    ]);
    assert.deepEqual(preview.rows[1]?.warnings, ["unknown division: Appliances"]);
    assert.match(preview.rows[1]?.draft.dueDate ?? "", /^\d{4}-10-02$/);
  });

  it("returns an empty preview when no table headers are found", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Notes").addRow(["just", "some", "cells"]);
    const preview = await parseImportFile({ filename: "x.xlsx", bytes: new Uint8Array(await wb.xlsx.writeBuffer()) }, ctx);
    assert.deepEqual(preview, { filename: "x.xlsx", sheetNames: ["Notes"], detectedTables: [], rows: [] });
  });
});

describe("parseImportFile (csv and errors)", () => {
  it("parses a CSV with the WHO header; the table is named after the file", async () => {
    const csv =
      "Date,Note,Division,WHO,Priority,Due Date,Status\r\n" +
      '9/12/2026,"Call Vince, then send the quote",HG,VM,High,10/15/2026,Not Started\r\n' +
      ",,,,,,\r\n" +
      "9/13/2026,Watch the Riemer margin,Reimer Floors,SB,,2026-10-31,In Progress\r\n";
    const preview = await parseImportFile({ filename: "todo list.csv", bytes: new TextEncoder().encode(csv) }, ctx);
    assert.deepEqual(preview.sheetNames, ["todo list"]);
    assert.deepEqual(preview.detectedTables, ["todo list"]);
    assert.deepEqual(
      preview.rows.map((r) => [r.rowNumber, r.table, r.draft.category, r.draft.title, r.draft.divisionCode, r.draft.ownerInitials, r.draft.dueDate, r.draft.status]),
      [
        [2, "todo list", "A", "Call Vince, then send the quote", "HG", "VM", "2026-10-15", "Open"],
        [4, "todo list", "A", "Watch the Riemer margin", "RF", "SB", "2026-10-31", "In Progress"],
      ],
    );
    assert.deepEqual(preview.rows[0]?.raw, {
      Date: "9/12/2026",
      Note: "Call Vince, then send the quote",
      Division: "HG",
      WHO: "VM",
      Priority: "High",
      "Due Date": "10/15/2026",
      Status: "Not Started",
    });
  });

  it("sniffs file kinds and rejects empty, legacy .xls and unknown files with 422", async () => {
    assert.equal(sniffFileKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "whatever.bin"), "workbook");
    assert.equal(sniffFileKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), "old.xls"), "xls");
    assert.equal(sniffFileKind(new TextEncoder().encode("a,b"), "x.csv"), "csv");
    assert.equal(sniffFileKind(new TextEncoder().encode("a,b"), "x.pdf"), "unknown");

    await assert.rejects(parseImportFile({ filename: "empty.csv", bytes: new Uint8Array() }, ctx), (err: unknown) => err instanceof ValidationError && err.status === 422);
    await assert.rejects(
      parseImportFile({ filename: "old.xls", bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]) }, ctx),
      (err: unknown) => err instanceof ValidationError && /\.xls/.test(err.message),
    );
    await assert.rejects(
      parseImportFile({ filename: "doc.pdf", bytes: new TextEncoder().encode("%PDF-1.4") }, ctx),
      (err: unknown) => err instanceof ValidationError && /Unsupported file type \.pdf/.test(err.message),
    );
    await assert.rejects(
      parseImportFile({ filename: "broken.xlsx", bytes: new TextEncoder().encode("not a zip at all") }, ctx),
      (err: unknown) => err instanceof ValidationError && /Could not read the workbook/.test(err.message),
    );
  });
});

describe("cellDataFromValue", () => {
  it("renders every ExcelJS value shape as text and keeps typed values", () => {
    assert.deepEqual(cellDataFromValue(null), { text: "", value: null });
    assert.deepEqual(cellDataFromValue("  hi "), { text: "hi", value: "  hi " });
    assert.deepEqual(cellDataFromValue(42), { text: "42", value: 42 });
    assert.deepEqual(cellDataFromValue(true), { text: "TRUE", value: true });
    const d = new Date(Date.UTC(2026, 9, 15));
    assert.deepEqual(cellDataFromValue(d), { text: "2026-10-15", value: d });
    assert.deepEqual(cellDataFromValue({ richText: [{ text: "a " }, { text: "b" }] }), { text: "a b", value: "a b" });
    assert.deepEqual(cellDataFromValue({ text: "Link", hyperlink: "https://example.com" }), { text: "Link", value: "Link" });
    assert.deepEqual(cellDataFromValue({ formula: "A1+1", result: 7 }), { text: "7", value: 7 });
    assert.deepEqual(cellDataFromValue({ sharedFormula: "A1", result: d }), { text: "2026-10-15", value: d });
    assert.deepEqual(cellDataFromValue({ error: "#N/A" }), { text: "", value: null });
  });
});
