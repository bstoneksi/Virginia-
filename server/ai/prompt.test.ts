import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SEED_DIVISIONS, SEED_PEOPLE } from "../../shared/types";
import type { ExtractContext, ExtractInput, ProposalDraft } from "../contracts";
import { ADDED_BY_RULE_WARNING, NB_TARGET_WARNING, createRosterResolver, parseTaggedLines } from "./grammar";
import { INFERRED_MAX_CONFIDENCE, STABLE_SYSTEM_PROMPT, buildUserText, mergeRuleProposals, normalizeModelProposal, postProcessModelOutput, proposalSimilarity } from "./prompt";
import type { ExtractedProposal, ExtractionOutput } from "./schema";

const ctx: ExtractContext = {
  people: SEED_PEOPLE.map((p, i) => ({ ...p, id: i + 1 })),
  divisions: SEED_DIVISIONS,
  initiatives: [
    { id: 1, name: "BAU", status: "Active", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: 2, name: "Showroom Refresh", status: "Active", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: 3, name: "Old Thing", status: "Complete", createdAt: "2026-01-01T00:00:00.000Z" },
  ],
};
const TODAY = "2026-09-30";

function input(overrides: Partial<ExtractInput> = {}): ExtractInput {
  return { text: null, images: [], context: null, defaultDivisionCode: null, todayISO: TODAY, ...overrides };
}

function modelProposal(overrides: Partial<ExtractedProposal> = {}): ExtractedProposal {
  return {
    category: "A",
    title: "Call Vince about the install",
    note: "",
    ownerInitials: null,
    divisionCode: null,
    initiativeName: null,
    priority: "Medium",
    status: "Open",
    dueDate: null,
    isPersonal: false,
    confidence: 0.95,
    inferred: false,
    sourceExcerpt: null,
    warnings: [],
    ...overrides,
  };
}

function output(proposals: ExtractedProposal[], notes: string[] = []): ExtractionOutput {
  return { proposals, notes };
}

describe("STABLE_SYSTEM_PROMPT", () => {
  it("encodes the SPEC §5 rules and contains nothing volatile", () => {
    for (const needle of [
      '"A:", "Q:", "I:", "D:", "W:", "NB:"',
      '"A -", "(A)", "A)"',
      "circled or boxed letter",
      "unknown person: XX",
      NB_TARGET_WARNING,
      "PTD",
      "Initiative: Name",
      "EOW",
      "inferred=true with confidence at most 0.7",
      "Do not invent owners",
      'Decisions ("D") default to "Done"',
      "at most 140 characters, no trailing period",
      "Return an empty proposals list when nothing is actionable",
      "<capture>",
    ]) {
      assert.ok(STABLE_SYSTEM_PROMPT.includes(needle), `system prompt should mention: ${needle}`);
    }
    // Roster, division names and dates live in the user message so the system prompt stays cacheable.
    assert.doesNotMatch(STABLE_SYSTEM_PROMPT, /Vincent|Moynihan|Henderson|Paramount|Riemer|20\d\d-\d\d-\d\d/);
  });
});

describe("buildUserText", () => {
  it("lists roster, divisions, initiatives, today, context, default division and the capture text", () => {
    const text = buildUserText(
      input({ text: "A: VM call Vince", context: "1:1 with VM", defaultDivisionCode: "HG", images: [{ filename: "IMG_1.PNG", mime: "image/png", bytes: new Uint8Array(1) }] }),
      ctx,
    );
    assert.match(text, /## Roster[\s\S]*- VM → Vincent Moynihan → HG/);
    assert.match(text, /- BS → Brandon Stone → FOB \(this is Brandon/);
    assert.match(text, /## Division codes[\s\S]*- K&B-I → K&B Installation \(brand, part of K&B\)/);
    assert.match(text, /- PTD → Personal \(personal: express as isPersonal=true/);
    assert.match(text, /## Initiatives\n- BAU \(Active\)\n- Showroom Refresh \(Active\)\n\n/);
    assert.doesNotMatch(text, /Old Thing/, "completed initiatives are left out");
    assert.match(text, /## Today\n2026-09-30 \(Wednesday\), America\/Detroit/);
    assert.match(text, /## Context\n1:1 with VM/);
    assert.match(text, /## Default division\nHG — Henderson Glass/);
    assert.match(text, /## Attached images\n1 image\(s\), in order: IMG_1.PNG/);
    assert.match(text, /## Capture text\n<capture>\nA: VM call Vince\n<\/capture>$/);
    // Sections in the required order.
    const order = ["## Roster", "## Division codes", "## Initiatives", "## Today", "## Context", "## Default division", "## Attached images", "## Capture text"];
    const positions = order.map((h) => text.indexOf(h));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
    assert.ok(positions.every((p) => p >= 0));
  });

  it("has placeholders for missing pieces and honours the attached-image override", () => {
    const text = buildUserText(
      input({ defaultDivisionCode: "NOPE", images: [{ filename: "a.heic", mime: "image/heic", bytes: new Uint8Array(1) }] }),
      { ...ctx, people: ctx.people.map((p) => ({ ...p, archived: p.initials === "JR" })), initiatives: [] },
      { imageFilenames: [] },
    );
    assert.match(text, /## Context\n\(none\)/);
    assert.match(text, /## Default division\nNOPE \(not a known code — treat as none\)/);
    assert.match(text, /## Attached images\n\(none\)/);
    assert.match(text, /\(no text — extract from the attached image\(s\) only\)/);
    assert.match(text, /## Initiatives\n\(none yet/);
    assert.doesNotMatch(text, /Jennifer Rankin/, "archived people are left out");
  });
});

describe("normalizeModelProposal", () => {
  const resolver = createRosterResolver(ctx);

  it("scrubs unknown initials and division codes into warnings", () => {
    const pd = normalizeModelProposal(modelProposal({ ownerInitials: "Brooke", divisionCode: "XYZ" }), input(), resolver);
    assert.ok(pd);
    assert.equal(pd.draft.ownerInitials, null);
    assert.equal(pd.draft.divisionCode, null);
    assert.deepEqual(pd.warnings, ["unknown person: Brooke", "unknown division: XYZ"]);
    assert.match(pd.draft.note, /Brooke/);
  });

  it("canonicalises people, division variants and initiatives", () => {
    const pd = normalizeModelProposal(modelProposal({ ownerInitials: "Vincent Moynihan", divisionCode: "kb-i", initiativeName: "showroom refresh" }), input(), resolver);
    assert.ok(pd);
    assert.equal(pd.draft.ownerInitials, "VM");
    assert.equal(pd.draft.divisionCode, "K&B-I");
    assert.equal(pd.draft.initiativeName, "Showroom Refresh");
    assert.deepEqual(pd.warnings, []);
    const unique = normalizeModelProposal(modelProposal({ ownerInitials: "Patrick", initiativeName: "Toledo Launch" }), input(), resolver);
    assert.equal(unique?.draft.ownerInitials, "PH");
    assert.equal(unique?.draft.initiativeName, "Toledo Launch");
    assert.deepEqual(unique?.warnings, ["new initiative: Toledo Launch"]);
  });

  it("treats the personal division as isPersonal and clears the division on personal items", () => {
    assert.equal(normalizeModelProposal(modelProposal({ divisionCode: "PTD" }), input(), resolver)?.draft.isPersonal, true);
    assert.equal(normalizeModelProposal(modelProposal({ divisionCode: "PTD" }), input(), resolver)?.draft.divisionCode, null);
    const personal = normalizeModelProposal(modelProposal({ divisionCode: "HG", isPersonal: true }), input({ defaultDivisionCode: "PF" }), resolver);
    assert.equal(personal?.draft.divisionCode, null);
  });

  it("applies the default division when the model left it null", () => {
    assert.equal(normalizeModelProposal(modelProposal(), input({ defaultDivisionCode: "hg" }), resolver)?.draft.divisionCode, "HG");
    assert.equal(normalizeModelProposal(modelProposal({ divisionCode: "PF" }), input({ defaultDivisionCode: "HG" }), resolver)?.draft.divisionCode, "PF");
    assert.equal(normalizeModelProposal(modelProposal(), input({ defaultDivisionCode: "PTD" }), resolver)?.draft.divisionCode, null);
  });

  it("clamps confidence and caps inferred items at 0.7", () => {
    assert.equal(normalizeModelProposal(modelProposal({ confidence: 1.7 }), input(), resolver)?.confidence, 1);
    assert.equal(normalizeModelProposal(modelProposal({ confidence: -2 }), input(), resolver)?.confidence, 0);
    assert.equal(normalizeModelProposal(modelProposal({ confidence: Number.NaN }), input(), resolver)?.confidence, 0.5);
    assert.equal(normalizeModelProposal(modelProposal({ confidence: 0.95, inferred: true }), input(), resolver)?.confidence, INFERRED_MAX_CONFIDENCE);
    assert.equal(normalizeModelProposal(modelProposal({ confidence: 0.4, inferred: true }), input(), resolver)?.confidence, 0.4);
  });

  it("defaults decisions to Done and keeps explicit statuses", () => {
    assert.equal(normalizeModelProposal(modelProposal({ category: "D" }), input(), resolver)?.draft.status, "Done");
    assert.equal(normalizeModelProposal(modelProposal({ category: "D", status: "Parked" }), input(), resolver)?.draft.status, "Parked");
    assert.equal(normalizeModelProposal(modelProposal({ category: "A", status: "In Progress" }), input(), resolver)?.draft.status, "In Progress");
  });

  it("validates due dates, repairing non-ISO forms and warning on garbage", () => {
    assert.equal(normalizeModelProposal(modelProposal({ dueDate: "2026-10-15" }), input(), resolver)?.draft.dueDate, "2026-10-15");
    assert.equal(normalizeModelProposal(modelProposal({ dueDate: "10/15" }), input(), resolver)?.draft.dueDate, "2026-10-15");
    assert.equal(normalizeModelProposal(modelProposal({ dueDate: "Friday" }), input(), resolver)?.draft.dueDate, "2026-10-02");
    const bad = normalizeModelProposal(modelProposal({ dueDate: "2026-02-30" }), input(), resolver);
    assert.equal(bad?.draft.dueDate, null);
    assert.deepEqual(bad?.warnings, ["could not read due date: 2026-02-30"]);
    assert.equal(normalizeModelProposal(modelProposal({ dueDate: "  " }), input(), resolver)?.draft.dueDate, null);
  });

  it("cleans titles, moves overflow into the note and drops title-less proposals", () => {
    assert.equal(normalizeModelProposal(modelProposal({ title: "  Call   Vince. " }), input(), resolver)?.draft.title, "Call Vince");
    const long = normalizeModelProposal(modelProposal({ title: "word ".repeat(40), note: "existing" }), input(), resolver);
    assert.ok(long);
    assert.ok(long.draft.title.length <= 140);
    assert.match(long.draft.note, /existing/);
    assert.ok(long.draft.note.length > 140);
    const fromNote = normalizeModelProposal(modelProposal({ title: "", note: "First line of the note\nmore" }), input(), resolver);
    assert.equal(fromNote?.draft.title, "First line of the note");
    const fromExcerpt = normalizeModelProposal(modelProposal({ title: "", note: "", sourceExcerpt: "A: VM from the excerpt" }), input(), resolver);
    assert.equal(fromExcerpt?.draft.title, "A: VM from the excerpt");
    assert.equal(normalizeModelProposal(modelProposal({ title: "", note: "", sourceExcerpt: null }), input(), resolver), null);
  });

  it("adds the NB warning once and trims excerpts", () => {
    const nb = normalizeModelProposal(modelProposal({ category: "NB", warnings: [NB_TARGET_WARNING, " ", NB_TARGET_WARNING], sourceExcerpt: "  NB: expand  " }), input(), resolver);
    assert.deepEqual(nb?.warnings, [NB_TARGET_WARNING]);
    assert.equal(nb?.sourceExcerpt, "NB: expand");
    assert.deepEqual(normalizeModelProposal(modelProposal({ category: "NB", ownerInitials: "VM" }), input(), resolver)?.warnings, []);
    assert.equal(normalizeModelProposal(modelProposal({ sourceExcerpt: "" }), input(), resolver)?.sourceExcerpt, null);
  });
});

describe("mergeRuleProposals / postProcessModelOutput", () => {
  const text = "A: VM call Vince about the HG install due 10/15\nQ: DK what is the plan for K&B-I?\nSome prose that is not tagged.";
  const rules = parseTaggedLines(text, ctx, TODAY, null);

  it("appends tagged lines the model dropped with the rule-parser warning", () => {
    const result = postProcessModelOutput(
      output([modelProposal({ title: "Call Vince about the install", ownerInitials: "VM", divisionCode: "HG", dueDate: "2026-10-15", sourceExcerpt: "A: VM call Vince about the HG install due 10/15" })], ["one note"]),
      input({ text }),
      ctx,
      rules,
    );
    assert.equal(result.proposals.length, 2);
    assert.equal(result.addedByRule, 1);
    assert.equal(result.proposals[0]?.draft.title, "Call Vince about the install");
    assert.deepEqual(result.proposals[0]?.warnings, []);
    const added = result.proposals[1];
    assert.ok(added);
    assert.equal(added.draft.category, "Q");
    assert.equal(added.draft.ownerInitials, "DK");
    assert.equal(added.draft.divisionCode, "K&B-I");
    assert.deepEqual(added.warnings, [ADDED_BY_RULE_WARNING]);
    assert.deepEqual(result.notes, ["one note", "Rule parser added 1 tagged line(s) the model left out"]);
  });

  it("does not duplicate tagged lines the model already covered and marks them as tagged", () => {
    const result = postProcessModelOutput(
      output([
        modelProposal({ title: "Call Vince about the install", ownerInitials: "VM", divisionCode: "HG", sourceExcerpt: "A: VM call Vince about the HG install due 10/15", inferred: true, confidence: 0.6 }),
        modelProposal({ category: "Q", title: "What is the plan for K&B-I?", ownerInitials: "DK", divisionCode: "K&B-I", sourceExcerpt: "Q: DK what is the plan for K&B-I?" }),
        modelProposal({ category: "W", title: "Watch the receivables", inferred: true, confidence: 0.5, sourceExcerpt: "Some prose that is not tagged." }),
      ]),
      input({ text }),
      ctx,
      rules,
    );
    assert.equal(result.proposals.length, 3);
    assert.equal(result.addedByRule, 0);
    assert.equal(result.proposals[0]?.inferred, false, "a tagged line is never inferred");
    assert.equal(result.proposals[0]?.draft.dueDate, "2026-10-15", "explicit tag data fills what the model left out");
    assert.equal(result.proposals[2]?.inferred, true);
    assert.deepEqual(result.notes, []);
  });

  it("lets the tag win over the model's category on a strong match", () => {
    const merged = mergeRuleProposals(
      [
        {
          draft: { ...modelProposal({ category: "A", title: "What is the plan for K&B-I", ownerInitials: "DK", divisionCode: "K&B-I" }), context: null },
          confidence: 0.8,
          inferred: false,
          sourceExcerpt: "Q: DK what is the plan for K&B-I?",
          warnings: [],
        },
      ],
      rules.filter((r) => r.draft.category === "Q"),
      null,
    );
    assert.equal(merged.added, 0);
    assert.equal(merged.proposals[0]?.draft.category, "Q");
    assert.match(merged.proposals[0]?.warnings[0] ?? "", /category Q taken from the tag/);
  });

  it("measures similarity by excerpt containment or word overlap", () => {
    const rule = rules[0];
    assert.ok(rule);
    const same: ProposalDraft = { ...rule, sourceExcerpt: "A: VM call Vince about the HG install due 10/15" };
    assert.equal(proposalSimilarity(rule, same), 1);
    const unrelated: ProposalDraft = { ...rule, draft: { ...rule.draft, title: "Order flooring samples" }, sourceExcerpt: "order flooring samples for Steve" };
    assert.ok(proposalSimilarity(rule, unrelated) < 0.5);
  });

  it("reports dropped proposals and caps model notes", () => {
    const result = postProcessModelOutput(output([modelProposal({ title: "", note: "", sourceExcerpt: null })], Array.from({ length: 12 }, (_, i) => `note ${i}`)), input(), ctx, []);
    assert.equal(result.proposals.length, 0);
    assert.equal(result.dropped, 1);
    assert.equal(result.notes.length, 9);
    assert.equal(result.notes[8], "Dropped 1 model proposal(s) without a title");
  });
});
