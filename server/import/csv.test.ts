import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectDelimiter, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("handles quoted fields, doubled quotes, embedded newlines and CRLF", () => {
    const text = 'Date,Note,Owner\r\n9/12/2026,"Call Vince, then send the ""final"" quote",VM\r\n9/13/2026,"Two\nlines",\r\n';
    assert.deepEqual(parseCsv(text), [
      ["Date", "Note", "Owner"],
      ["9/12/2026", 'Call Vince, then send the "final" quote', "VM"],
      ["9/13/2026", "Two\nlines", ""],
    ]);
  });

  it("strips a UTF-8 BOM, auto-detects semicolons and tabs and drops empty trailing rows", () => {
    assert.deepEqual(parseCsv("﻿a;b;c\n1;2;3\n\n;;\n"), [
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
    assert.deepEqual(parseCsv("a\tb\n1\t2"), [
      ["a", "b"],
      ["1", "2"],
    ]);
    assert.equal(detectDelimiter('x,"y;z";w'), ",");
    assert.equal(detectDelimiter("x;y;z"), ";");
    assert.equal(detectDelimiter("single"), ",");
  });

  it("keeps blank rows in the middle so row numbers stay aligned with the file", () => {
    const rows = parseCsv("h1,h2\n\n1,2\n");
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[1], [""]);
    assert.deepEqual(rows[2], ["1", "2"]);
    assert.deepEqual(parseCsv(""), []);
  });
});
