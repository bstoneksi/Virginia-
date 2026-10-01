import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALL_LANE,
  NO_BRAND_LANE,
  PERSONAL_LANE,
  UNASSIGNED_LANE,
  assignLane,
  columnId,
  divisionLaneKey,
  groupItems,
  isGroupMode,
  laneAssignment,
  laneKeyFor,
  parseColumnId,
  personLaneKey,
  reassignment,
  type GroupContext,
} from "./boardGroups";
import { SEED_DIVISIONS, SEED_PEOPLE, type Item, type Person } from "./types";

let seq = 0;
function mk(overrides: Partial<Item> = {}): Item {
  seq += 1;
  return {
    id: `item-${String(seq).padStart(3, "0")}`,
    category: "A",
    title: `Item ${seq}`,
    note: "",
    divisionCode: null,
    ownerInitials: null,
    initiativeId: null,
    priority: "Medium",
    status: "Open",
    dueDate: null,
    rank: seq,
    isPersonal: false,
    context: null,
    sourceCaptureId: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

const PEOPLE: Person[] = SEED_PEOPLE.map((p, i) => ({ ...p, id: i + 1 }));
const CTX: GroupContext = { divisions: SEED_DIVISIONS, people: PEOPLE, meInitials: "BS" };

describe("isGroupMode", () => {
  it("accepts the three modes and nothing else", () => {
    assert.ok(isGroupMode("none") && isGroupMode("brand") && isGroupMode("person"));
    assert.equal(isGroupMode("owner"), false);
    assert.equal(isGroupMode(null), false);
    assert.equal(isGroupMode(1), false);
  });
});

describe("groupItems — none", () => {
  it("returns a single lane with everything in input order, even when empty", () => {
    assert.deepEqual(
      groupItems([], "none", CTX).map((l) => [l.key, l.items.length]),
      [[ALL_LANE, 0]],
    );
    const a = mk({ divisionCode: "HG" });
    const b = mk({ ownerInitials: "VM" });
    const [lane] = groupItems([a, b], "none", CTX);
    assert.equal(lane?.kind, "all");
    assert.deepEqual(lane?.items.map((i) => i.id), [a.id, b.id]);
  });
});

describe("groupItems — brand", () => {
  it("orders lanes by division sortOrder, omits empty divisions and puts No brand / Personal last", () => {
    const items = [
      mk({ divisionCode: "RF" }), // sortOrder 50 — appears first in input, must not come first
      mk({ divisionCode: null }),
      mk({ divisionCode: "HG" }), // 30
      mk({ isPersonal: true }),
      mk({ divisionCode: "K&B" }), // 10
    ];
    const lanes = groupItems(items, "brand", CTX);
    assert.deepEqual(
      lanes.map((l) => l.key),
      [divisionLaneKey("K&B"), divisionLaneKey("HG"), divisionLaneKey("RF"), NO_BRAND_LANE, PERSONAL_LANE],
    );
    assert.deepEqual(
      lanes.map((l) => l.label),
      ["KSI Kitchen & Bath", "Henderson Glass", "Riemer Floors", "No brand", "Personal"],
    );
  });

  it("carries the division chip and colours, and the PTD colour for the Personal lane", () => {
    const lanes = groupItems([mk({ divisionCode: "HG" }), mk({ isPersonal: true })], "brand", CTX);
    const hg = lanes.find((l) => l.key === divisionLaneKey("HG"));
    assert.equal(hg?.kind, "division");
    assert.equal(hg?.chip, "HG");
    assert.deepEqual(hg?.color, { bg: "#C0392B", fg: "#FFFFFF" });
    const personal = lanes.find((l) => l.key === PERSONAL_LANE);
    assert.equal(personal?.kind, "personal");
    assert.equal(personal?.chip, "PTD");
    assert.deepEqual(personal?.color, { bg: "#B08968", fg: "#FFFFFF" });
    const noBrand = groupItems([mk()], "brand", CTX)[0];
    assert.equal(noBrand?.kind, "nobrand");
    assert.equal(noBrand?.chip, undefined);
  });

  it("puts personal items in the Personal lane even when they carry a division code", () => {
    const item = mk({ divisionCode: "HG", isPersonal: true });
    const lanes = groupItems([item], "brand", CTX);
    assert.deepEqual(lanes.map((l) => l.key), [PERSONAL_LANE]);
  });

  it("gives an unknown division code its own neutral lane after the known divisions", () => {
    const lanes = groupItems([mk({ divisionCode: "ZZZ" }), mk({ divisionCode: "PF" }), mk()], "brand", CTX);
    assert.deepEqual(lanes.map((l) => l.key), [divisionLaneKey("PF"), divisionLaneKey("ZZZ"), NO_BRAND_LANE]);
    const stray = lanes[1];
    assert.equal(stray?.label, "ZZZ");
    assert.equal(stray?.chip, "ZZZ");
    assert.equal(stray?.color, undefined);
  });

  it("keeps items in input order inside a lane and partitions every item exactly once", () => {
    const items = [
      mk({ divisionCode: "HG", status: "Open" }),
      mk({ divisionCode: "PF" }),
      mk({ divisionCode: "HG", status: "Done" }),
      mk({ divisionCode: "HG", status: "Parked" }),
      mk({ isPersonal: true }),
      mk(),
    ];
    const lanes = groupItems(items, "brand", CTX);
    const hg = lanes.find((l) => l.key === divisionLaneKey("HG"));
    assert.deepEqual(hg?.items.map((i) => i.id), [items[0]?.id, items[2]?.id, items[3]?.id]);
    const all = lanes.flatMap((l) => l.items.map((i) => i.id)).sort();
    assert.deepEqual(all, items.map((i) => i.id).sort());
  });

  it("keeps a lane listed in keepEmpty even when it holds no items", () => {
    const lanes = groupItems([mk({ divisionCode: "PF" })], "brand", { ...CTX, keepEmpty: [divisionLaneKey("HG"), PERSONAL_LANE] });
    assert.deepEqual(lanes.map((l) => [l.key, l.items.length]), [
      [divisionLaneKey("HG"), 0],
      [divisionLaneKey("PF"), 1],
      [PERSONAL_LANE, 0],
    ]);
  });

  it("keeps an unknown-code lane listed in keepEmpty too", () => {
    const lanes = groupItems([], "brand", { ...CTX, keepEmpty: [divisionLaneKey("ZZZ")] });
    assert.deepEqual(lanes.map((l) => l.key), [divisionLaneKey("ZZZ")]);
  });
});

describe("groupItems — person", () => {
  it("orders lanes by full name and puts the owner's own lane — his cards plus the unowned ones — last", () => {
    const items = [
      mk({ ownerInitials: "VM" }), // Vincent Moynihan
      mk({ ownerInitials: null }), // blank owner = me (SPEC §3)
      mk({ ownerInitials: "AG" }), // Amanda Gentner
      mk({ ownerInitials: "BS" }), // me
      mk({ ownerInitials: "SB" }), // Steve Bevel
    ];
    const lanes = groupItems(items, "person", CTX);
    assert.deepEqual(
      lanes.map((l) => l.key),
      [personLaneKey("AG"), personLaneKey("SB"), personLaneKey("VM"), personLaneKey("BS")],
    );
    assert.deepEqual(
      lanes.map((l) => l.label),
      ["Amanda Gentner", "Steve Bevel", "Vincent Moynihan", "Brandon Stone (me)"],
    );
    const mine = lanes.at(-1);
    assert.equal(mine?.kind, "person");
    assert.equal(mine?.chip, "BS");
    assert.equal(mine?.color, undefined);
    assert.deepEqual(mine?.items.map((i) => i.id), [items[1]?.id, items[3]?.id], "unowned and BS-owned cards share the me lane, input order kept");
    assert.ok(!lanes.some((l) => l.key === UNASSIGNED_LANE), "no separate unassigned lane when somebody is me");
  });

  it("resolves me from the roster's isMe flag when the context does not name them", () => {
    const lanes = groupItems([mk()], "person", { ...CTX, meInitials: null });
    assert.deepEqual(lanes.map((l) => [l.key, l.label]), [[personLaneKey("BS"), "Brandon Stone (me)"]]);
  });

  it("labels the null-owner lane plainly when nobody is marked me", () => {
    const nobody = PEOPLE.map((p) => ({ ...p, isMe: false }));
    const lanes = groupItems([mk()], "person", { divisions: SEED_DIVISIONS, people: nobody, meInitials: null });
    assert.deepEqual(lanes.map((l) => l.label), ["Unassigned"]);
    assert.equal(lanes[0]?.kind, "unassigned");
    assert.equal(lanes[0]?.chip, undefined);
  });

  it("gives unknown initials their own lane after the roster and before the me lane", () => {
    const lanes = groupItems([mk({ ownerInitials: "XX" }), mk({ ownerInitials: "VM" })], "person", CTX);
    assert.deepEqual(lanes.map((l) => l.key), [personLaneKey("VM"), personLaneKey("XX")]);
    assert.equal(lanes[1]?.label, "XX");
    const withMine = groupItems([mk({ ownerInitials: "XX" }), mk()], "person", CTX);
    assert.deepEqual(withMine.map((l) => l.key), [personLaneKey("XX"), personLaneKey("BS")]);
  });

  it("keeps the me lane listed in keepEmpty even when it holds no items", () => {
    const lanes = groupItems([mk({ ownerInitials: "VM" })], "person", { ...CTX, keepEmpty: [personLaneKey("BS")] });
    assert.deepEqual(lanes.map((l) => [l.key, l.items.length]), [
      [personLaneKey("VM"), 1],
      [personLaneKey("BS"), 0],
    ]);
  });

  it("includes archived people when they still own items", () => {
    const people = PEOPLE.map((p) => (p.initials === "VM" ? { ...p, archived: true } : p));
    const lanes = groupItems([mk({ ownerInitials: "VM" })], "person", { ...CTX, people });
    assert.deepEqual(lanes.map((l) => l.label), ["Vincent Moynihan"]);
  });
});

describe("laneKeyFor / laneAssignment / reassignment", () => {
  it("round-trips: assigning a lane's fields lands the item in that lane", () => {
    const base = mk({ divisionCode: "HG", ownerInitials: "VM" });
    for (const key of [divisionLaneKey("PF"), NO_BRAND_LANE, PERSONAL_LANE]) {
      assert.equal(laneKeyFor(assignLane(base, key, "brand"), "brand"), key);
    }
    for (const key of [personLaneKey("SB"), UNASSIGNED_LANE]) {
      assert.equal(laneKeyFor(assignLane(base, key, "person"), "person"), key);
    }
    assert.equal(laneKeyFor(assignLane(base, personLaneKey("BS"), "person", "BS"), "person", "BS"), personLaneKey("BS"));
    assert.equal(laneKeyFor(base, "none"), ALL_LANE);
  });

  it("files an unowned card under me when somebody is me, else under Unassigned", () => {
    assert.equal(laneKeyFor(mk(), "person"), UNASSIGNED_LANE);
    assert.equal(laneKeyFor(mk(), "person", null), UNASSIGNED_LANE);
    assert.equal(laneKeyFor(mk(), "person", "BS"), personLaneKey("BS"));
    assert.equal(laneKeyFor(mk({ ownerInitials: "VM" }), "person", "BS"), personLaneKey("VM"));
  });

  it("describes the brand-lane patches", () => {
    assert.deepEqual(laneAssignment(divisionLaneKey("PF"), "brand"), { isPersonal: false, divisionCode: "PF" });
    assert.deepEqual(laneAssignment(NO_BRAND_LANE, "brand"), { isPersonal: false, divisionCode: null });
    assert.deepEqual(laneAssignment(PERSONAL_LANE, "brand"), { isPersonal: true, divisionCode: null });
    assert.deepEqual(laneAssignment(personLaneKey("SB"), "person"), { ownerInitials: "SB" });
    assert.deepEqual(laneAssignment(UNASSIGNED_LANE, "person"), { ownerInitials: null });
    assert.deepEqual(laneAssignment(ALL_LANE, "none"), {});
    assert.deepEqual(laneAssignment(divisionLaneKey("PF"), "person"), {});
  });

  it("sends only the fields that change, and nothing when the card already sits in the lane", () => {
    const hg = mk({ divisionCode: "HG", ownerInitials: "VM" });
    assert.equal(reassignment(hg, divisionLaneKey("HG"), "brand"), null);
    assert.deepEqual(reassignment(hg, divisionLaneKey("PF"), "brand"), { divisionCode: "PF" });
    assert.deepEqual(reassignment(hg, PERSONAL_LANE, "brand"), { divisionCode: null, isPersonal: true });
    assert.deepEqual(reassignment(hg, NO_BRAND_LANE, "brand"), { divisionCode: null });
    const personal = mk({ isPersonal: true });
    assert.deepEqual(reassignment(personal, divisionLaneKey("HG"), "brand"), { divisionCode: "HG", isPersonal: false });
    assert.deepEqual(reassignment(personal, NO_BRAND_LANE, "brand"), { isPersonal: false });
    assert.equal(reassignment(hg, personLaneKey("VM"), "person"), null);
    assert.deepEqual(reassignment(hg, personLaneKey("SB"), "person"), { ownerInitials: "SB" });
    assert.deepEqual(reassignment(hg, UNASSIGNED_LANE, "person"), { ownerInitials: null });
    assert.deepEqual(reassignment(mk(), personLaneKey("SB"), "person"), { ownerInitials: "SB" });
    assert.equal(reassignment(hg, ALL_LANE, "none"), null);
  });

  it("treats the me lane as home for both unowned and explicitly owned cards", () => {
    const unowned = mk();
    const mine = mk({ ownerInitials: "BS" });
    const theirs = mk({ ownerInitials: "VM" });
    // Moving within the me lane changes nothing — the blank owner stays blank, the explicit BS stays BS.
    assert.equal(reassignment(unowned, personLaneKey("BS"), "person", "BS"), null);
    assert.equal(reassignment(mine, personLaneKey("BS"), "person", "BS"), null);
    assert.equal(assignLane(unowned, personLaneKey("BS"), "person", "BS").ownerInitials, null);
    // Arriving from another lane takes the initials explicitly.
    assert.deepEqual(reassignment(theirs, personLaneKey("BS"), "person", "BS"), { ownerInitials: "BS" });
    assert.equal(assignLane(theirs, personLaneKey("BS"), "person", "BS").ownerInitials, "BS");
    // Leaving the me lane for a person's lane sets that person; the unowned card gets an owner for the first time.
    assert.deepEqual(reassignment(unowned, personLaneKey("VM"), "person", "BS"), { ownerInitials: "VM" });
  });

  it("assignLane leaves the other lane fields untouched", () => {
    const base = mk({ divisionCode: "HG", ownerInitials: "VM", isPersonal: false });
    const moved = assignLane(base, personLaneKey("SB"), "person");
    assert.equal(moved.ownerInitials, "SB");
    assert.equal(moved.divisionCode, "HG");
    assert.equal(moved.id, base.id);
    const branded = assignLane(base, divisionLaneKey("PF"), "brand");
    assert.equal(branded.divisionCode, "PF");
    assert.equal(branded.ownerInitials, "VM");
  });
});

describe("columnId / parseColumnId", () => {
  it("round-trips lane keys that contain punctuation", () => {
    for (const lane of [ALL_LANE, divisionLaneKey("K&B-I"), personLaneKey("VM"), UNASSIGNED_LANE, "div:odd::code"]) {
      for (const status of ["Open", "In Progress", "Parked", "Done"] as const) {
        assert.deepEqual(parseColumnId(columnId(lane, status)), { lane, status });
      }
    }
  });

  it("rejects card ids and malformed ids", () => {
    assert.equal(parseColumnId("5d1c1b8e-0d3a-4a3e-9f1a-2b3c4d5e6f70"), null);
    assert.equal(parseColumnId("Open"), null);
    assert.equal(parseColumnId("all::Nope"), null);
    assert.equal(parseColumnId(42), null);
  });
});
