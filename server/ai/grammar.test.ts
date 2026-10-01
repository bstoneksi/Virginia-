import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtractContext } from "../contracts";
import { exampleDivisions, examplePeople } from "../lib/testing";
import {
  NB_TARGET_WARNING,
  RULE_CONFIDENCE,
  createRosterResolver,
  hasTaggedLines,
  matchTag,
  normalizeCode,
  parseTaggedLine,
  parseTaggedLines,
  resolveDuePhrase,
  splitTitle,
  weekdayName,
} from "./grammar";

const ctx: ExtractContext = {
  people: examplePeople,
  divisions: exampleDivisions,
  initiatives: [
    { id: 1, name: "BAU", status: "Active", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: 2, name: "Showroom Refresh", status: "Active", createdAt: "2026-01-01T00:00:00.000Z" },
  ],
};
// 2026-09-30 is a Wednesday and the last day of the month.
const TODAY = "2026-09-30";

function line(text: string, defaultDivision: string | null = null) {
  const pd = parseTaggedLine(text, ctx, TODAY, defaultDivision);
  assert.ok(pd, `expected a proposal for: ${text}`);
  return pd;
}

describe("matchTag", () => {
  it("accepts every tag form and strips bullets / list numbers", () => {
    assert.equal(matchTag("A: x")?.category, "A");
    assert.equal(matchTag("Q: x")?.category, "Q");
    assert.equal(matchTag("I: x")?.category, "I");
    assert.equal(matchTag("D: x")?.category, "D");
    assert.equal(matchTag("W: x")?.category, "W");
    assert.equal(matchTag("NB: x")?.category, "NB");
    assert.equal(matchTag("N.B. x")?.category, "NB");
    assert.equal(matchTag("nb: x")?.category, "NB");
    assert.equal(matchTag("(A) x")?.category, "A");
    assert.equal(matchTag("A) x")?.category, "A");
    assert.equal(matchTag("A - x")?.category, "A");
    assert.equal(matchTag("A:x")?.rest, "x");
    assert.equal(matchTag("- A: bullet")?.rest, "bullet");
    assert.equal(matchTag("• Q: dot")?.rest, "dot");
    assert.equal(matchTag("2) Q: numbered")?.rest, "numbered");
    assert.deepEqual(matchTag("  - A: indented"), { category: "A", rest: "indented", indent: 2 });
    assert.equal(matchTag("\tW: tabbed")?.indent, 4);
  });

  it("accepts lower-case colon / dash tags but not lower-case list enumerators", () => {
    assert.equal(matchTag("a: lower")?.category, "A");
    assert.equal(matchTag("a - lower")?.category, "A");
    assert.equal(matchTag("(a) enumerator"), null);
    assert.equal(matchTag("a) enumerator"), null);
  });

  it("ignores words that merely start with a tag letter", () => {
    for (const s of ["Alpha: something", "Brandon: we should call Vince", "Note: x", "I'm here", "Q&A: x", "D-Day plan", "Just a note", "", "A:"]) {
      assert.equal(matchTag(s), null, s);
    }
  });
});

describe("parseTaggedLine", () => {
  it("reads tag, owner, division and a numeric due date", () => {
    const pd = line("A: VM Call Vince about the HG install due 10/15");
    assert.equal(pd.draft.category, "A");
    assert.equal(pd.draft.ownerInitials, "VM");
    assert.equal(pd.draft.divisionCode, "HG");
    assert.equal(pd.draft.dueDate, "2026-10-15");
    assert.equal(pd.draft.title, "Call Vince about the install");
    assert.equal(pd.draft.note, "");
    assert.equal(pd.draft.status, "Open");
    assert.equal(pd.draft.priority, "Medium");
    assert.equal(pd.inferred, false);
    assert.equal(pd.confidence, RULE_CONFIDENCE);
    assert.equal(pd.sourceExcerpt, "A: VM Call Vince about the HG install due 10/15");
    assert.deepEqual(pd.warnings, []);
  });

  it("handles every category with the alternate tag forms", () => {
    const q = line("(Q) DK what is the plan for K&B-I?");
    assert.equal(q.draft.category, "Q");
    assert.equal(q.draft.ownerInitials, "DK");
    assert.equal(q.draft.divisionCode, "K&B-I");
    assert.equal(q.draft.title, "What is the plan for?");
    assert.equal(line("W) RF cash position").draft.category, "W");
    assert.equal(line("- I: build a dashboard").draft.title, "Build a dashboard");
    assert.equal(line("NB: PF fence quote for the school").draft.category, "NB");
    assert.equal(line("D: go with vendor B").draft.category, "D");
    assert.equal(line("N.B. Toledo lead").draft.category, "NB");
    assert.equal(line("1. A: SB order flooring samples Oct 15").draft.ownerInitials, "SB");
  });

  it("resolves initials in any order in the leading run, case-insensitively, and never from words", () => {
    assert.equal(line("A: vm call back").draft.ownerInitials, "VM");
    assert.equal(line("A: VM: send numbers").draft.title, "Send numbers");
    assert.equal(line("A: (VM) send numbers").draft.ownerInitials, "VM");
    const both = line("A: HG VM call back");
    assert.equal(both.draft.ownerInitials, "VM");
    assert.equal(both.draft.divisionCode, "HG");
    const swapped = line("A: VM HG call back");
    assert.equal(swapped.draft.ownerInitials, "VM");
    assert.equal(swapped.draft.divisionCode, "HG");
    assert.equal(swapped.draft.title, "Call back");
    // "An" is a word, not Amanda Norton; "I" is a pronoun.
    assert.equal(line("A: An update on hiring").draft.ownerInitials, null);
    assert.equal(line("A: An update on hiring").draft.title, "An update on hiring");
    assert.equal(line("A: I need to call Vince").draft.ownerInitials, null);
    assert.equal(line("A: OK to proceed?").draft.ownerInitials, null);
    assert.deepEqual(line("A: OK to proceed?").warnings, []);
  });

  it("flags unknown initials and keeps them in the note", () => {
    const pd = line("a: TJ call the vendor by Friday");
    assert.equal(pd.draft.ownerInitials, null);
    assert.deepEqual(pd.warnings, ["unknown person: TJ"]);
    assert.match(pd.draft.note, /TJ/);
    assert.equal(pd.draft.title, "Call the vendor");
    assert.equal(pd.draft.dueDate, "2026-10-02");
    // Only the leading run counts: later acronyms are content.
    const later = line("A: talk to Brooke about EDM");
    assert.deepEqual(later.warnings, []);
    assert.equal(later.draft.title, "Talk to Brooke about EDM");
  });

  it("records co-owners in the note", () => {
    const pd = line("A: VM/DK joint call with the vendor");
    assert.equal(pd.draft.ownerInitials, "VM");
    assert.equal(pd.draft.note, "Also: David Karras (DK)");
    assert.equal(pd.draft.title, "Joint call with the vendor");
  });

  it("matches division codes anywhere, case-insensitively, including K&B variants", () => {
    assert.equal(line("A: KB showroom lights").draft.divisionCode, "K&B");
    assert.equal(line("A: K+B showroom lights").draft.divisionCode, "K&B");
    assert.equal(line("A: K & B showroom lights").draft.divisionCode, "K&B");
    assert.equal(line("A: DK k+b-i install schedule").draft.divisionCode, "K&B-I");
    assert.equal(line("A: DK kbi install schedule").draft.divisionCode, "K&B-I");
    assert.equal(line("A: review the s&m budget").draft.divisionCode, "S&M");
    assert.equal(line("A: review the s&m budget").draft.title, "Review the budget");
    assert.equal(line("A: hg call back").draft.divisionCode, "HG");
    assert.equal(line("A: call back (HG)").draft.title, "Call back");
    assert.equal(line("A: call back (HG)").draft.divisionCode, "HG");
  });

  it("does not turn ordinary words into division codes", () => {
    assert.equal(line("A: fix the app login").draft.divisionCode, null);
    assert.equal(line("A: App store listing").draft.divisionCode, null);
    assert.equal(line("A: DK APP inventory count").draft.divisionCode, "APP");
    assert.equal(line("A: DK APP inventory count").draft.title, "Inventory count");
  });

  it("recognises a division written out by name without stripping it from the title", () => {
    const pd = line("A: call Henderson Glass about the quote");
    assert.equal(pd.draft.divisionCode, "HG");
    assert.equal(pd.draft.title, "Call Henderson Glass about the quote");
  });

  it("applies the default division only when the line names none", () => {
    assert.equal(line("A: VM call back", "HG").draft.divisionCode, "HG");
    assert.equal(line("A: VM PF call back", "HG").draft.divisionCode, "PF");
    assert.equal(line("A: VM call back").draft.divisionCode, null);
    assert.equal(line("A: VM call back", "NOPE").draft.divisionCode, null, "unknown default is ignored");
    assert.equal(line("A: VM call back", "PTD").draft.divisionCode, null, "the personal division is never a default");
  });

  it("handles personal items (PTD / personal / the PTD division)", () => {
    const personal = line("A - PTD pick up dry cleaning tomorrow", "HG");
    assert.equal(personal.draft.isPersonal, true);
    assert.equal(personal.draft.divisionCode, null, "personal items never carry a division");
    assert.equal(personal.draft.dueDate, "2026-10-01");
    assert.equal(personal.draft.title, "Pick up dry cleaning");
    assert.equal(line("A: renew passport (personal)").draft.isPersonal, true);
    assert.equal(line("A: renew passport (personal)").draft.title, "Renew passport");
    assert.equal(line("A: HG PTD mixed signals").draft.isPersonal, true);
    assert.equal(line("A: HG PTD mixed signals").draft.divisionCode, null);
    assert.equal(line("A: ptd call mom").draft.isPersonal, true);
    assert.equal(line("A: call mom").draft.isPersonal, false);
  });

  it("maps urgency and parking-lot words to priority and status", () => {
    const urgent = line("W: RF cash position !! watch the receivables");
    assert.equal(urgent.draft.priority, "High");
    assert.equal(urgent.draft.divisionCode, "RF");
    assert.equal(urgent.draft.title, "Cash position watch the receivables");
    assert.equal(line("A: ASAP send the contract").draft.priority, "High");
    assert.equal(line("A: ASAP send the contract").draft.title, "Send the contract");
    assert.equal(line("A: urgent: send the contract").draft.priority, "High");
    assert.equal(line("W: lead volume low priority").draft.priority, "Low");
    assert.equal(line("W: lead volume low priority").draft.title, "Lead volume");

    assert.equal(line("I: someday build a dashboard").draft.status, "Parked");
    assert.equal(line("I: someday build a dashboard").draft.title, "Build a dashboard");
    assert.equal(line("A: parking lot - revisit signage").draft.status, "Parked");
    assert.equal(line("A: parking lot - revisit signage").draft.title, "Revisit signage");
    assert.equal(line("I: new CRM when we get to it").draft.status, "Parked");
    assert.equal(line("I: new CRM, back burner").draft.status, "Parked");
    assert.equal(line("A: VM in progress: draft the proposal").draft.status, "In Progress");
    assert.equal(line("A: VM in progress: draft the proposal").draft.title, "Draft the proposal");
    assert.equal(line("A: sent the contract - done").draft.status, "Done");
    assert.equal(line("A: sent the contract - done").draft.title, "Sent the contract");
    assert.equal(line("A: get it done today").draft.status, "Open", "'done' mid-sentence is not a status");
  });

  it("defaults decisions to Done unless parked", () => {
    assert.equal(line("D: go with vendor B").draft.status, "Done");
    assert.equal(line("d: someday decide on vendor").draft.status, "Parked", "parked wins over the decision default");
    assert.equal(line("D: go with vendor B").draft.title, "Go with vendor B");
  });

  it("flags NB without a target", () => {
    assert.deepEqual(line("NB: expand into Toledo").warnings, [NB_TARGET_WARNING]);
    assert.deepEqual(line("NB: expand into Toledo", "HG").warnings, []);
    assert.deepEqual(line("NB: VM expand into Toledo").warnings, []);
    assert.deepEqual(line("NB: PF fence quote for the school").warnings, []);
  });

  it("extracts initiative names (canonical casing) and removes them from the title", () => {
    const pd = line("A: VM pick tiles, Initiative: showroom refresh");
    assert.equal(pd.draft.initiativeName, "Showroom Refresh");
    assert.equal(pd.draft.title, "Pick tiles");
    const fresh = line("A: DK k+b-i install schedule, Initiative: Toledo Launch");
    assert.equal(fresh.draft.initiativeName, "Toledo Launch");
    assert.equal(fresh.draft.divisionCode, "K&B-I");
    assert.equal(fresh.draft.title, "Install schedule");
  });

  it("resolves due phrases relative to today", () => {
    assert.equal(line("A: VM: send numbers EOW").draft.dueDate, "2026-10-02");
    assert.equal(line("A: VM: send numbers EOW").draft.title, "Send numbers");
    assert.equal(line("A: DK APP inventory count EOM").draft.dueDate, "2026-09-30");
    assert.equal(line("A: KB showroom lights next week").draft.dueDate, "2026-10-05");
    assert.equal(line("A: BS review the budget 12-24-2026").draft.dueDate, "2026-12-24");
    assert.equal(line("A: SB order samples Oct 15").draft.dueDate, "2026-10-15");
    assert.equal(line("A: SB order samples due 10/15/2027").draft.dueDate, "2027-10-15");
    assert.equal(line("A: prep for Monday").draft.dueDate, "2026-10-05");
    assert.equal(line("A: no date here").draft.dueDate, null);
  });

  it("keeps a first sentence as the title and moves the rest to the note", () => {
    const pd = line("Q: is the plan final? Need it by Friday.");
    assert.equal(pd.draft.title, "Is the plan final?");
    assert.equal(pd.draft.dueDate, "2026-10-02");
    assert.match(pd.draft.note, /Need it/);
    assert.equal(line("A: Follow up with Mr. Smith about the quote.").draft.title, "Follow up with Mr. Smith about the quote");
  });

  it("truncates long titles into the note", () => {
    const long = line(`A: ${"word ".repeat(40).trim()}`);
    assert.ok(long.draft.title.length <= 140);
    assert.ok(long.draft.title.endsWith("…"));
    assert.ok(long.draft.note.length > 140);
    assert.deepEqual(splitTitle("short"), { title: "short", rest: null });
    assert.deepEqual(splitTitle("Call Vince today. He wants the numbers."), { title: "Call Vince today", rest: "He wants the numbers" });
  });

  it("accepts a legacy string as the default-division argument and an options object", () => {
    assert.equal(parseTaggedLine("A: VM call", ctx, TODAY, "HG")?.draft.divisionCode, "HG");
    assert.equal(parseTaggedLine("A: VM call", ctx, TODAY, { defaultDivisionCode: "PF" })?.draft.divisionCode, "PF");
    assert.equal(parseTaggedLine("A: VM call", ctx, TODAY, { continuation: ["  detail"] })?.draft.note, "detail");
  });

  it("returns null for untagged lines", () => {
    assert.equal(parseTaggedLine("Just a note", ctx, TODAY), null);
    assert.equal(parseTaggedLine("Brandon: we should call Vince", ctx, TODAY), null);
    assert.equal(parseTaggedLine("(a) first option", ctx, TODAY), null);
    assert.equal(parseTaggedLine("", ctx, TODAY), null);
  });
});

describe("resolveDuePhrase", () => {
  it("resolves relative phrases against today (a Wednesday, last day of the month)", () => {
    assert.equal(resolveDuePhrase("send it by Friday", TODAY)?.dueDate, "2026-10-02");
    assert.equal(resolveDuePhrase("send it by wed", TODAY)?.dueDate, TODAY, "same weekday means today");
    assert.equal(resolveDuePhrase("finish EOW", TODAY)?.dueDate, "2026-10-02");
    assert.equal(resolveDuePhrase("finish by end of week", TODAY)?.dueDate, "2026-10-02");
    assert.equal(resolveDuePhrase("finish this week", TODAY)?.dueDate, "2026-10-02");
    assert.equal(resolveDuePhrase("close the books EOM", TODAY)?.dueDate, "2026-09-30");
    assert.equal(resolveDuePhrase("close the books by end of month", TODAY)?.dueDate, "2026-09-30");
    assert.equal(resolveDuePhrase("start next week", TODAY)?.dueDate, "2026-10-05");
    assert.equal(resolveDuePhrase("start next month", TODAY)?.dueDate, "2026-10-01");
    assert.equal(resolveDuePhrase("call tomorrow", TODAY)?.dueDate, "2026-10-01");
    assert.equal(resolveDuePhrase("call by today", TODAY)?.dueDate, TODAY);
    assert.equal(resolveDuePhrase("call EOD", TODAY)?.dueDate, TODAY);
    assert.equal(resolveDuePhrase("next Friday", TODAY)?.dueDate, "2026-10-09", "the Friday of next week");
    assert.equal(resolveDuePhrase("this Friday", TODAY)?.dueDate, "2026-10-02");
    assert.equal(resolveDuePhrase("on Monday", TODAY)?.dueDate, "2026-10-05");
    assert.equal(resolveDuePhrase("in 2 weeks", TODAY)?.dueDate, "2026-10-14");
    assert.equal(resolveDuePhrase("in three days", TODAY)?.dueDate, "2026-10-03");
    assert.equal(resolveDuePhrase("Monday standup", TODAY), null, "a bare weekday is not a due date");
  });

  it("resolves explicit dates and rolls year-less past dates forward", () => {
    assert.equal(resolveDuePhrase("due Oct 15", TODAY)?.dueDate, "2026-10-15");
    assert.equal(resolveDuePhrase("due October 15th, 2027", TODAY)?.dueDate, "2027-10-15");
    assert.equal(resolveDuePhrase("due 15 Oct", TODAY)?.dueDate, "2026-10-15");
    assert.equal(resolveDuePhrase("due January 5th", TODAY)?.dueDate, "2027-01-05", "rolls into next year");
    assert.equal(resolveDuePhrase("due 1/5", TODAY)?.dueDate, "2027-01-05");
    assert.equal(resolveDuePhrase("on 9/28", TODAY)?.dueDate, "2026-09-28", "a few days ago stays (overdue)");
    assert.equal(resolveDuePhrase("due 10/15/27", TODAY)?.dueDate, "2027-10-15");
    assert.equal(resolveDuePhrase("due 12-24-2026", TODAY)?.dueDate, "2026-12-24");
    assert.equal(resolveDuePhrase("due 2026-11-02", TODAY)?.dueDate, "2026-11-02");
    assert.equal(resolveDuePhrase("10/15", TODAY)?.dueDate, "2026-10-15", "bare mm/dd counts");
    assert.equal(resolveDuePhrase("no date here", TODAY), null);
    assert.equal(resolveDuePhrase("due 13/45", TODAY), null);
    assert.equal(resolveDuePhrase("split 50/50", TODAY), null);
    assert.equal(resolveDuePhrase("3/4 of the team", TODAY), null, "fractions are not dates");
    assert.equal(resolveDuePhrase("due 2/30", TODAY), null, "impossible dates are rejected");
  });

  it("prefers an explicit due/by phrase over a bare date and reports what it matched", () => {
    const m = resolveDuePhrase("by Friday send the 10/15 report", TODAY);
    assert.equal(m?.dueDate, "2026-10-02");
    assert.equal(m?.matched, "by Friday");
    assert.equal(m?.index, 0);
    assert.equal(resolveDuePhrase("garbage", "not-a-date"), null);
  });
});

describe("helpers", () => {
  it("normalises codes and names weekdays", () => {
    assert.equal(normalizeCode("K&B-I"), "KBI");
    assert.equal(normalizeCode("k+b-i"), "KBI");
    assert.equal(normalizeCode("S&M"), "SM");
    assert.equal(weekdayName(TODAY), "Wednesday");
    assert.equal(weekdayName("nope"), "");
  });

  it("resolves people by initials, full name or a unique first / last name", () => {
    const r = createRosterResolver(ctx);
    assert.equal(r.person("vm")?.initials, "VM");
    assert.equal(r.person("Vincent Moynihan")?.initials, "VM");
    assert.equal(r.person("Patrick")?.initials, "PH");
    assert.equal(r.person("Amanda"), null, "ambiguous first name");
    assert.equal(r.person("Rankin")?.initials, "JR");
    assert.equal(r.person("Brooke"), null);
    assert.equal(r.division("kb-s")?.code, "K&B-S");
    assert.equal(r.division("Henderson Glass")?.code, "HG");
    assert.equal(r.division("nope"), null);
    assert.equal(r.divisionInText("meeting about Paramount Fence pricing")?.code, "PF");
    assert.equal(r.initiative("bau")?.name, "BAU");
  });
});

describe("parseTaggedLines", () => {
  it("returns one proposal per tagged line, in order, with CRLF and blank lines", () => {
    const text = "Meeting notes\r\nA: VM one\r\n\r\nQ: DK two\nrandom\nW: three";
    const out = parseTaggedLines(text, ctx, TODAY, "HG");
    assert.deepEqual(
      out.map((p) => [p.draft.category, p.draft.title, p.draft.divisionCode]),
      [
        ["A", "One", "HG"],
        ["Q", "Two", "HG"],
        ["W", "Three", "HG"],
      ],
    );
    assert.ok(hasTaggedLines(text));
    assert.equal(hasTaggedLines("nothing here"), false);
  });

  it("attaches indented continuation lines to the note and the excerpt", () => {
    const text = ["A: VM parent line", "    - child detail one", "    - child detail two", "Q: DK sibling question", "- untagged sibling bullet", "W: last"].join("\n");
    const out = parseTaggedLines(text, ctx, TODAY);
    assert.equal(out.length, 3);
    assert.equal(out[0]?.draft.note, "child detail one\nchild detail two");
    assert.equal(out[0]?.sourceExcerpt, "A: VM parent line\n- child detail one\n- child detail two");
    assert.equal(out[1]?.draft.note, "", "same-indentation bullets are not continuations");
    assert.equal(out[2]?.draft.title, "Last");
  });

  it("returns an empty list when nothing is tagged", () => {
    assert.deepEqual(parseTaggedLines("Just prose.\nMore prose.", ctx, TODAY), []);
    assert.deepEqual(parseTaggedLines("", ctx, TODAY), []);
  });
});
