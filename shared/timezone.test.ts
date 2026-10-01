import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_TIMEZONE, dateISOInTZ, isValidTimeZone } from "./timezone";

describe("timezone helpers", () => {
  it("defaults to the first instance's America/Detroit", () => {
    assert.equal(DEFAULT_TIMEZONE, "America/Detroit");
  });

  it("validates timezone names with Intl", () => {
    for (const tz of ["America/Detroit", "UTC", "Europe/Berlin", "Asia/Kolkata", "Pacific/Auckland"]) assert.equal(isValidTimeZone(tz), true, tz);
    for (const tz of ["", "   ", "Mars/Olympus_Mons", "Detroit", "America/Detroit/Downtown"]) assert.equal(isValidTimeZone(tz), false, JSON.stringify(tz));
  });

  it("gives the calendar date in the requested timezone", () => {
    // 03:30 UTC on Oct 1: still Sep 30 in Detroit (EDT, -4) and Los Angeles, already Oct 1 in UTC and Auckland.
    const t = new Date("2026-10-01T03:30:00.000Z");
    assert.equal(dateISOInTZ(t), "2026-09-30");
    assert.equal(dateISOInTZ(t, "America/Detroit"), "2026-09-30");
    assert.equal(dateISOInTZ(t, "America/Los_Angeles"), "2026-09-30");
    assert.equal(dateISOInTZ(t, "UTC"), "2026-10-01");
    assert.equal(dateISOInTZ(t, "Pacific/Auckland"), "2026-10-01");
  });

  it("is stable across the DST switches", () => {
    assert.equal(dateISOInTZ(new Date("2026-03-08T06:59:00.000Z"), "America/Detroit"), "2026-03-08"); // 01:59 EST, just before the jump
    assert.equal(dateISOInTZ(new Date("2026-03-08T07:01:00.000Z"), "America/Detroit"), "2026-03-08"); // 03:01 EDT
    assert.equal(dateISOInTZ(new Date("2026-11-01T04:30:00.000Z"), "America/Detroit"), "2026-11-01"); // 00:30 EDT
    assert.equal(dateISOInTZ(new Date("2026-11-01T03:30:00.000Z"), "America/Detroit"), "2026-10-31"); // 23:30 EDT the night before
  });

  it("rejects an unknown timezone loudly rather than silently using the system zone", () => {
    assert.throws(() => dateISOInTZ(new Date(), "Mars/Olympus_Mons"), RangeError);
  });
});
