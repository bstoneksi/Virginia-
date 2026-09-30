import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SEED_DIVISIONS, SEED_PEOPLE } from "../../shared/types";
import type { Person } from "../../shared/types";
import type { ExtractContext } from "../contracts";
import {
  buildImportRow,
  categoryForTable,
  excelSerialToISO,
  extractLeadingTag,
  isoFromDate,
  mapPriority,
  mapStatus,
  matchDivision,
  matchPerson,
  parseDateText,
  parseDueDate,
  splitPeople,
  titleFromNote,
} from "./mapping";
import type { DetectedTable, TableRow } from "./tables";

const people: Person[] = SEED_PEOPLE.map((p, i) => ({ ...p, id: i + 1 }));
const ctx: ExtractContext = { divisions: SEED_DIVISIONS, people, initiatives: [] };
const TODAY = "2026-09-30";

describe("matchDivision", () => {
  const code = (text: string): string | null => matchDivision(text, SEED_DIVISIONS)?.code ?? null;

  it("matches codes and names exactly, case-insensitively", () => {
    assert.equal(code("HG"), "HG");
    assert.equal(code("hg"), "HG");
    assert.equal(code("k&b-i"), "K&B-I");
    assert.equal(code("K&B - I"), "K&B-I");
    assert.equal(code("henderson glass"), "HG");
    assert.equal(code("KSI Kitchen & Bath"), "K&B");
    assert.equal(code("Personal"), "PTD");
  });

  it("knows the Brain Dump vocabulary", () => {
    assert.equal(code("Kitchen & Bath - Install"), "K&B-I");
    assert.equal(code("Kitchen & Bath Installation"), "K&B-I");
    assert.equal(code("Kitchen & Bath - Sales"), "K&B-S");
    assert.equal(code("K&B Ops"), "K&B-O");
    assert.equal(code("Kitchen & Bath"), "K&B");
    assert.equal(code("Henderson"), "HG");
    assert.equal(code("Riemer"), "RF");
    assert.equal(code("Reimer Floors"), "RF");
    assert.equal(code("Appliance"), "APP");
    assert.equal(code("Appliances"), "APP");
    assert.equal(code("Fence"), "PF");
    assert.equal(code("Paramount"), "PF");
    assert.equal(code("TrueScale"), "TS");
    assert.equal(code("True Scale Studio"), "TS");
    assert.equal(code("Corporate"), "FOB");
    assert.equal(code("FOB"), "FOB");
    assert.equal(code("Family of Brands"), "FOB");
    assert.equal(code("Accounting"), "ACC");
    assert.equal(code("Finance"), "ACC");
    assert.equal(code("Sales & Marketing"), "S&M");
    assert.equal(code("Marketing"), "S&M");
    assert.equal(code("personal to-do"), "PTD");
  });

  it("returns null for unknown or ambiguous text and ignores archived divisions", () => {
    assert.equal(code("Cabinets Express"), null);
    assert.equal(code("Sales"), null); // K&B Sales vs Sales & Marketing
    assert.equal(code(""), null);
    assert.equal(code("   "), null);
    const archivedHG = SEED_DIVISIONS.map((d) => (d.code === "HG" ? { ...d, archived: true } : d));
    assert.equal(matchDivision("Henderson", archivedHG), null);
  });

  it("falls back to a unique token overlap for divisions added later", () => {
    const template = SEED_DIVISIONS[0];
    assert.ok(template);
    const divisions = [...SEED_DIVISIONS, { ...template, code: "CE", name: "Cabinets Express", parentCode: null }];
    assert.equal(matchDivision("Cabinet Express", divisions)?.code, "CE"); // prefix + exact token overlap
    assert.equal(matchDivision("Express", divisions)?.code, "CE");
    assert.equal(matchDivision("Cabinets Express", SEED_DIVISIONS), null); // not seeded → unmatched
  });
});

describe("matchPerson", () => {
  const initials = (text: string): string | null => matchPerson(text, people)?.initials ?? null;

  it("matches initials (case-insensitive, dots ignored), full names and Last, First", () => {
    assert.equal(initials("VM"), "VM");
    assert.equal(initials("vm"), "VM");
    assert.equal(initials("V.M."), "VM");
    assert.equal(initials("Vincent Moynihan"), "VM");
    assert.equal(initials("vincent moynihan"), "VM");
    assert.equal(initials("Moynihan Vincent"), "VM");
    assert.equal(initials("me"), "BS");
    assert.equal(initials("Brandon Stone"), "BS");
  });

  it("resolves nicknames, unique first or last names and 'First L' but not ambiguous ones", () => {
    assert.equal(initials("Vince"), "VM");
    assert.equal(initials("Matt Norton"), "MN");
    assert.equal(initials("Josh"), "JM");
    assert.equal(initials("Steven Bevel"), "SB");
    assert.equal(initials("Moynihan"), "VM");
    assert.equal(initials("Amanda G"), "AG");
    assert.equal(initials("Amanda"), null);
    assert.equal(initials("Norton"), null);
    assert.equal(initials("Brooke"), null);
    assert.equal(initials(""), null);
  });

  it("splits owner lists", () => {
    assert.deepEqual(splitPeople("VM / SB"), ["VM", "SB"]);
    assert.deepEqual(splitPeople("VM, SB & DK"), ["VM", "SB", "DK"]);
    assert.deepEqual(splitPeople("Vince and Steve"), ["Vince", "Steve"]);
    assert.deepEqual(splitPeople("Amanda Gentner"), ["Amanda Gentner"]);
  });
});

describe("dates", () => {
  const serial = Math.round((Date.UTC(2026, 9, 15) - Date.UTC(1899, 11, 30)) / 86400000);

  it("converts Excel serials and Date objects (UTC calendar date)", () => {
    assert.equal(excelSerialToISO(serial), "2026-10-15");
    assert.equal(excelSerialToISO(serial + 0.75), "2026-10-15");
    assert.equal(excelSerialToISO(0), null);
    assert.equal(excelSerialToISO(Number.NaN), null);
    assert.equal(isoFromDate(new Date(Date.UTC(2026, 9, 15))), "2026-10-15");
    assert.equal(isoFromDate(new Date(Date.UTC(2026, 9, 15, 23, 59))), "2026-10-15");
    assert.equal(isoFromDate(new Date(Number.NaN)), null);
  });

  it("parses the text formats that show up in exports", () => {
    assert.equal(parseDateText("10/15/2026"), "2026-10-15");
    assert.equal(parseDateText("10/15/26"), "2026-10-15");
    assert.equal(parseDateText("10-15-2026"), "2026-10-15");
    assert.equal(parseDateText("10/15", TODAY), "2026-10-15");
    assert.equal(parseDateText("2026-10-15"), "2026-10-15");
    assert.equal(parseDateText("2026-10-15T00:00:00.000Z"), "2026-10-15");
    assert.equal(parseDateText("10/15/2026 0:00"), "2026-10-15");
    assert.equal(parseDateText("Oct 15, 2026"), "2026-10-15");
    assert.equal(parseDateText("October 15th"), "2026-10-15".replace("2026", String(new Date().getUTCFullYear())));
    assert.equal(parseDateText("15 Oct 2026"), "2026-10-15");
    assert.equal(parseDateText("Thursday, October 15, 2026"), "2026-10-15");
    assert.equal(parseDateText(String(serial)), "2026-10-15");
    assert.equal(parseDateText("13/45/2026"), null);
    assert.equal(parseDateText("2/30/2026"), null);
    assert.equal(parseDateText("TBD"), null);
    assert.equal(parseDateText(""), null);
  });

  it("parseDueDate prefers typed values, treats TBD-like text as no date and flags garbage", () => {
    assert.deepEqual(parseDueDate({ text: "2026-10-15", value: new Date(Date.UTC(2026, 9, 15)) }), { dueDate: "2026-10-15", invalid: null });
    assert.deepEqual(parseDueDate({ text: String(serial), value: serial }), { dueDate: "2026-10-15", invalid: null });
    assert.deepEqual(parseDueDate({ text: "15", value: 15 }), { dueDate: null, invalid: "15" }, "a small number in the column is not 1900-01-14");
    assert.deepEqual(parseDueDate({ text: "123456", value: 123456 }), { dueDate: null, invalid: "123456" });
    assert.deepEqual(parseDueDate({ text: "10/20/2026", value: "10/20/2026" }), { dueDate: "2026-10-20", invalid: null });
    assert.deepEqual(parseDueDate({ text: "TBD", value: "TBD" }), { dueDate: null, invalid: null });
    assert.deepEqual(parseDueDate({ text: "-", value: "-" }), { dueDate: null, invalid: null });
    assert.deepEqual(parseDueDate({ text: "next Friday-ish", value: "next Friday-ish" }), { dueDate: null, invalid: "next Friday-ish" });
    assert.deepEqual(parseDueDate(undefined), { dueDate: null, invalid: null });
  });
});

describe("vocabularies", () => {
  it("maps Brain Dump statuses, with Parking Lot rows defaulting to Parked", () => {
    assert.deepEqual(mapStatus("Not Started", false), { status: "Open", unknown: false });
    assert.deepEqual(mapStatus("Not Started", true), { status: "Parked", unknown: false });
    assert.deepEqual(mapStatus("", true), { status: "Parked", unknown: false });
    assert.deepEqual(mapStatus("in progress", true), { status: "In Progress", unknown: false });
    assert.deepEqual(mapStatus("Complete", true), { status: "Done", unknown: false });
    assert.deepEqual(mapStatus("Completed", false), { status: "Done", unknown: false });
    assert.deepEqual(mapStatus("On Hold", false), { status: "Parked", unknown: false });
    assert.deepEqual(mapStatus("Whatever", false), { status: "Open", unknown: true });
  });

  it("maps priorities and categories", () => {
    assert.deepEqual(mapPriority(""), { priority: "Medium", unknown: false });
    assert.deepEqual(mapPriority("low"), { priority: "Low", unknown: false });
    assert.deepEqual(mapPriority("Med"), { priority: "Medium", unknown: false });
    assert.deepEqual(mapPriority("Urgent"), { priority: "High", unknown: false });
    assert.deepEqual(mapPriority("Purple"), { priority: "Medium", unknown: true });
    assert.deepEqual(categoryForTable("New Business"), { category: "NB", parked: false });
    assert.deepEqual(categoryForTable("Action Items"), { category: "A", parked: false });
    assert.deepEqual(categoryForTable("Parking Lot"), { category: "A", parked: true });
    assert.deepEqual(categoryForTable("Watch List"), { category: "W", parked: false });
    assert.equal(categoryForTable("Brain Dump"), null);
  });

  it("recognises explicit grammar tags at the start of a note", () => {
    assert.deepEqual(extractLeadingTag("Q: Should we consolidate?"), { category: "Q", rest: "Should we consolidate?" });
    assert.deepEqual(extractLeadingTag("• (W) Margin slipping"), { category: "W", rest: "Margin slipping" });
    assert.deepEqual(extractLeadingTag("NB - Builder group"), { category: "NB", rest: "Builder group" });
    assert.deepEqual(extractLeadingTag("D) Go with vendor B"), { category: "D", rest: "Go with vendor B" });
    assert.equal(extractLeadingTag("A-frame signs for the lot"), null);
    assert.equal(extractLeadingTag("Someday: rebrand the trucks"), null);
    assert.equal(extractLeadingTag("I need to call Vince"), null);
  });

  it("derives titles: bullets stripped, first sentence, 120-char cut, no trailing period", () => {
    assert.equal(titleFromNote("• Pitch the glass package to the builder group. Vince has the list."), "Pitch the glass package to the builder group");
    assert.equal(titleFromNote("Should we consolidate the leases? Ask AG."), "Should we consolidate the leases?");
    assert.equal(titleFromNote("Call re. the quote and confirm the 1.5 million number"), "Call re. the quote and confirm the 1.5 million number");
    assert.equal(titleFromNote("Line one\nLine two"), "Line one");
    const long = "word ".repeat(40).trim();
    const title = titleFromNote(long);
    assert.ok(title.length <= 121 && title.endsWith("…"), title);
    assert.equal(titleFromNote("   "), "");
  });
});

describe("buildImportRow", () => {
  const table: DetectedTable = {
    sheet: "Brain Dump",
    name: "New Business",
    headerRow: 3,
    firstCol: 1,
    lastCol: 7,
    columns: { date: 1, note: 2, division: 3, owner: 4, priority: 5, due: 6, status: 7 },
    labels: new Map([[1, "Date"], [2, "Note"], [3, "Division"], [4, "Owner/Target"], [5, "Priority"], [6, "Due Date"], [7, "Status"]]),
  };
  const cell = (text: string) => ({ text, value: text });
  const row = (cells: TableRow["cells"], rowNumber = 4): TableRow => ({
    rowNumber,
    cells,
    raw: Object.fromEntries([...table.labels.values()].map((label) => [label, ""])),
  });

  it("maps a clean row", () => {
    const out = buildImportRow(
      row({ date: cell("9/12/2026"), note: cell("Pitch the glass package. Details here."), division: cell("Henderson Glass"), owner: cell("Vince"), priority: cell("High"), due: cell("10/15/2026"), status: cell("In Progress") }),
      table,
      ctx,
      TODAY,
    );
    assert.deepEqual(out.warnings, []);
    assert.equal(out.include, true);
    assert.equal(out.table, "New Business");
    assert.equal(out.sheet, "Brain Dump");
    assert.equal(out.rowNumber, 4);
    assert.deepEqual(out.draft, {
      category: "NB",
      title: "Pitch the glass package",
      note: "Pitch the glass package. Details here.",
      divisionCode: "HG",
      ownerInitials: "VM",
      initiativeName: null,
      priority: "High",
      status: "In Progress",
      dueDate: "2026-10-15",
      isPersonal: false,
      context: null,
    });
  });

  it("warns on unmatched division / person, invalid dates, unknown words and NB without a target", () => {
    const out = buildImportRow(
      row({ note: cell("Intro to Cabinets Express"), division: cell("Cabinets Express"), owner: cell("Brooke"), priority: cell("Purple"), due: cell("13/45/2026"), status: cell("Maybe") }),
      table,
      ctx,
      TODAY,
    );
    assert.deepEqual(out.warnings, [
      "unknown division: Cabinets Express",
      "unknown person: Brooke",
      "unknown priority: Purple",
      "unknown status: Maybe",
      "invalid due date: 13/45/2026",
      "NB needs a target",
    ]);
    assert.equal(out.draft.divisionCode, null);
    assert.equal(out.draft.ownerInitials, null);
    assert.equal(out.draft.priority, "Medium");
    assert.equal(out.draft.status, "Open");
    assert.equal(out.draft.dueDate, null);
  });

  it("treats the Personal division as isPersonal, honours explicit tags and multiple owners", () => {
    const parking: DetectedTable = { ...table, name: "Parking Lot" };
    const out = buildImportRow(row({ note: cell("Q: Should we move the showroom?"), division: cell("Personal"), owner: cell("VM / SB / Nobody") }), parking, ctx, TODAY);
    assert.equal(out.draft.category, "Q");
    assert.equal(out.draft.title, "Should we move the showroom?");
    assert.equal(out.draft.note, "Q: Should we move the showroom?");
    assert.equal(out.draft.isPersonal, true);
    assert.equal(out.draft.divisionCode, null);
    assert.equal(out.draft.status, "Parked");
    assert.equal(out.draft.ownerInitials, "VM");
    assert.deepEqual(out.warnings, ["multiple owners: used VM, also SB", "unknown person: Nobody"]);
  });

  it("uses a Category column when present and defaults unknown tables to A", () => {
    const plain: DetectedTable = { ...table, name: "todo", columns: { ...table.columns, category: 8 } };
    const watch = buildImportRow(row({ note: cell("Margins"), category: cell("Watch") }), plain, ctx, TODAY);
    assert.equal(watch.draft.category, "W");
    const dflt = buildImportRow(row({ note: cell("Do the thing") }), plain, ctx, TODAY);
    assert.equal(dflt.draft.category, "A");
    assert.equal(dflt.draft.status, "Open");
    assert.deepEqual(dflt.warnings, []);
  });
});
