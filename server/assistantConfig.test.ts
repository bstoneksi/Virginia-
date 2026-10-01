import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import {
  ASSISTANT_CONFIG_FILE,
  ASSISTANT_CONFIG_LOCAL_FILE,
  AssistantConfigError,
  assistantConfigProblems,
  loadAssistantConfig,
  parseAssistantConfig,
  readAssistantConfigFile,
  resolveAssistantConfigPath,
  toAssistantInfo,
  toSeed,
} from "./assistantConfig";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface RawDivision {
  code: string;
  name: string;
  kind: string;
  parentCode: string | null;
  color: string;
  textColor: string;
  sortOrder: number;
}
interface RawPerson {
  initials: string;
  fullName: string;
  divisionCode: string | null;
  email: string | null;
  role: string | null;
}
interface RawConfig {
  assistant: { name?: string; tagline: string };
  owner: { fullName: string; initials: string; email: string | null; role: string | null; timezone: string; divisionCode?: string | null; [key: string]: unknown };
  organization: { name: string; shortName: string };
  branding: { themeColor: string; accentColor: string };
  personalDivisionCode?: string;
  defaultInitiative?: string;
  divisions: RawDivision[];
  people: RawPerson[];
}

/** A small valid config (not Brandon's) that the failure cases mutate. */
function valid(): RawConfig {
  return {
    assistant: { name: "Ada", tagline: "Executive assistant tracker" },
    owner: { fullName: "Ada Lovelace", initials: "AL", email: "ada@example.com", role: "COO", timezone: "Europe/London", divisionCode: "HQ" },
    organization: { name: "Analytical Engines", shortName: "AE" },
    branding: { themeColor: "#112233", accentColor: "#445566" },
    divisions: [
      { code: "HQ", name: "Headquarters", kind: "function", parentCode: null, color: "#000000", textColor: "#FFFFFF", sortOrder: 1 },
      { code: "HQ-OPS", name: "Operations", kind: "function", parentCode: "HQ", color: "#000000", textColor: "#FFFFFF", sortOrder: 2 },
      { code: "PTD", name: "Personal", kind: "personal", parentCode: null, color: "#B08968", textColor: "#FFFFFF", sortOrder: 100 },
    ],
    people: [
      { initials: "CB", fullName: "Charles Babbage", divisionCode: "HQ", email: null, role: null },
      { initials: "MS", fullName: "Mary Somerville", divisionCode: null, email: "mary@example.com", role: "Advisor" },
    ],
  };
}

/** Runs `fn`, expects an AssistantConfigError and returns it. */
function configError(fn: () => unknown): AssistantConfigError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof AssistantConfigError, `expected an AssistantConfigError, got ${String(err)}`);
    return err;
  }
  assert.fail("expected the config to be rejected");
}

describe("assistant config: schema and cross-field validation", () => {
  it("accepts a valid config and fills the documented defaults", () => {
    const config = parseAssistantConfig(valid(), "test");
    assert.equal(config.assistant.name, "Ada");
    assert.equal(config.owner.divisionCode, "HQ");
    assert.equal(config.personalDivisionCode, "PTD");
    assert.equal(config.defaultInitiative, "BAU");
    assert.equal(config.people.length, 2);
    assert.deepEqual(assistantConfigProblems(config), []);
  });

  it("treats owner.divisionCode, emails, roles and people as optional", () => {
    const raw = valid();
    delete raw.owner.divisionCode;
    const config = parseAssistantConfig({ ...raw, owner: { fullName: "Ada Lovelace", initials: "AL", timezone: "UTC" }, people: undefined }, "test");
    assert.equal(config.owner.divisionCode, null);
    assert.equal(config.owner.email, null);
    assert.equal(config.owner.role, null);
    assert.deepEqual(config.people, []);
  });

  it("lists duplicate initials, the owner repeated in people, an unknown parentCode and a bad timezone — all at once", () => {
    const raw = valid();
    raw.people.push({ initials: "cb", fullName: "Charles Again", divisionCode: null, email: null, role: null }); // same initials, other case
    raw.people.push({ initials: "al", fullName: "Ada Twice", divisionCode: null, email: null, role: null }); // the owner
    const ops = raw.divisions[1];
    assert.ok(ops);
    ops.parentCode = "HQX";
    raw.owner.timezone = "Mars/Olympus_Mons";

    const err = configError(() => parseAssistantConfig(raw, "my.json"));
    assert.equal(err.problems.length, 4, err.message);
    assert.match(err.message, /^my\.json has 4 problems:\n/);
    assert.match(err.message, /people\[2\]\.initials: duplicate initials "cb"/);
    assert.match(err.message, /people\[3\]\.initials: "al" are the owner's initials/);
    assert.match(err.message, /divisions\[1\]\.parentCode: parentCode "HQX" is not a listed division/);
    assert.match(err.message, /owner\.timezone: "Mars\/Olympus_Mons" is not a valid IANA timezone/);
  });

  it("explains a reference that only differs in case, a duplicate code, a self-parent and a parent cycle", () => {
    const raw = valid();
    const person = raw.people[0];
    assert.ok(person);
    person.divisionCode = "hq";
    raw.divisions.push({ code: "hq", name: "Lower-case twin", kind: "function", parentCode: null, color: "#000000", textColor: "#FFFFFF", sortOrder: 3 });
    raw.divisions.push({ code: "A", name: "A", kind: "brand", parentCode: "B", color: "#000000", textColor: "#FFFFFF", sortOrder: 4 });
    raw.divisions.push({ code: "B", name: "B", kind: "brand", parentCode: "A", color: "#000000", textColor: "#FFFFFF", sortOrder: 5 });
    raw.divisions.push({ code: "SELF", name: "Self", kind: "brand", parentCode: "SELF", color: "#000000", textColor: "#FFFFFF", sortOrder: 6 });

    const err = configError(() => parseAssistantConfig(raw, "test"));
    assert.match(err.message, /divisions\[3\]\.code: duplicate division code "hq" \(clashes with "HQ"/);
    assert.match(err.message, /people\[0\]\.divisionCode: divisionCode "hq" is not a listed division \(did you mean "HQ"\?\)/);
    assert.match(err.message, /divisions\[4\]\.parentCode: "A" is part of a parent cycle/);
    assert.match(err.message, /divisions\[5\]\.parentCode: "B" is part of a parent cycle/);
    assert.match(err.message, /divisions\[6\]\.parentCode: "SELF" cannot be its own parent/);
  });

  it("insists on one personal division that matches personalDivisionCode", () => {
    const raw = valid();
    raw.personalDivisionCode = "PERS";
    let err = configError(() => parseAssistantConfig(raw, "test"));
    assert.match(err.message, /personalDivisionCode: "PERS" does not match the personal division "PTD"/);

    const twice = valid();
    twice.divisions.push({ code: "ME", name: "Me", kind: "personal", parentCode: null, color: "#000000", textColor: "#FFFFFF", sortOrder: 7 });
    err = configError(() => parseAssistantConfig(twice, "test"));
    assert.match(err.message, /only one division may have kind "personal" \(found "PTD", "ME"\)/);
  });

  it("reports shape problems with their path, including misspelled keys", () => {
    const raw = valid();
    raw.branding.themeColor = "navy";
    const first = raw.divisions[0];
    assert.ok(first);
    first.kind = "team";
    delete raw.assistant.name;
    raw.owner.timeZone = "America/Detroit"; // misspelled: should be timezone

    const err = configError(() => parseAssistantConfig(raw, "test"));
    assert.match(err.message, /branding\.themeColor: must be a hex color/);
    assert.match(err.message, /divisions\[0\]\.kind: /);
    assert.match(err.message, /assistant\.name: /);
    assert.match(err.message, /owner: .*timeZone/);
    assert.ok(err.problems.length >= 4, err.message);
  });

  it("rejects non-objects readably", () => {
    assert.match(configError(() => parseAssistantConfig(null, "x.json")).message, /^x\.json has 1 problem:\n  - /);
    assert.match(configError(() => parseAssistantConfig([], "x.json")).message, /^x\.json has 1 problem:\n  - /);
  });
});

describe("assistant config: derived data", () => {
  it("toSeed: the owner becomes the first, only is_me person; the roster follows; the default initiative is created", () => {
    const seed = toSeed(parseAssistantConfig(valid(), "test"));
    assert.deepEqual(seed.people[0], {
      initials: "AL",
      fullName: "Ada Lovelace",
      divisionCode: "HQ",
      email: "ada@example.com",
      role: "COO",
      isMe: true,
      archived: false,
    });
    assert.deepEqual(
      seed.people.slice(1).map((p) => [p.initials, p.isMe, p.archived]),
      [
        ["CB", false, false],
        ["MS", false, false],
      ],
    );
    assert.equal(seed.people.filter((p) => p.isMe).length, 1);
    assert.deepEqual(
      seed.divisions.map((d) => [d.code, d.parentCode, d.archived]),
      [
        ["HQ", null, false],
        ["HQ-OPS", "HQ", false],
        ["PTD", null, false],
      ],
    );
    assert.deepEqual(seed.initiatives, ["BAU"]);
  });

  it("toSeed: an owner without a division is 'me' with divisionCode null", () => {
    const raw = valid();
    delete raw.owner.divisionCode;
    const seed = toSeed(parseAssistantConfig(raw, "test"));
    assert.equal(seed.people[0]?.isMe, true);
    assert.equal(seed.people[0]?.divisionCode, null);
  });

  it("toAssistantInfo exposes the public block the client needs", () => {
    assert.deepEqual(toAssistantInfo(parseAssistantConfig(valid(), "test")), {
      name: "Ada",
      tagline: "Executive assistant tracker",
      ownerName: "Ada Lovelace",
      ownerInitials: "AL",
      organization: "Analytical Engines",
      organizationShort: "AE",
      timezone: "Europe/London",
      themeColor: "#112233",
      accentColor: "#445566",
    });
  });
});

describe("assistant config: the checked-in files", () => {
  it("assistant.config.json (the first instance) validates and seeds Brandon as me", () => {
    const config = readAssistantConfigFile(path.join(rootDir, ASSISTANT_CONFIG_FILE));
    assert.equal(config.assistant.name, "Virginia");
    assert.equal(config.owner.initials, "BS");
    assert.equal(config.owner.timezone, "America/Detroit");
    assert.equal(config.divisions.length, 13);
    assert.equal(config.people.length, 11);
    const seed = toSeed(config);
    assert.equal(seed.people[0]?.isMe, true);
    assert.equal(seed.people[0]?.initials, "BS");
    assert.equal(seed.people[0]?.divisionCode, "FOB");
    assert.equal(seed.people.length, 12);
  });

  it("assistant.config.example.json (the template) validates", () => {
    const config = readAssistantConfigFile(path.join(rootDir, "assistant.config.example.json"));
    assert.equal(config.assistant.name, "Assistant");
    assert.equal(config.owner.initials, "ME");
    assert.deepEqual(assistantConfigProblems(config), []);
    assert.equal(toSeed(config).people.length, 3);
  });
});

describe("assistant config: file resolution", () => {
  let dir = "";
  const write = (name: string, value: unknown): string => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
    return file;
  };
  const named = (name: string): RawConfig => ({ ...valid(), assistant: { name, tagline: "Executive assistant tracker" } });

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "assistant-config-"));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to assistant.config.json, then honours ASSISTANT_CONFIG, and lets the local override win", () => {
    assert.equal(resolveAssistantConfigPath(dir, {}), path.join(dir, ASSISTANT_CONFIG_FILE));
    write(ASSISTANT_CONFIG_FILE, named("Default"));
    assert.equal(loadAssistantConfig(dir, {}).assistant.name, "Default");

    const custom = write("custom.json", named("Custom"));
    assert.equal(resolveAssistantConfigPath(dir, { ASSISTANT_CONFIG: "custom.json" }), custom);
    assert.equal(loadAssistantConfig(dir, { ASSISTANT_CONFIG: "custom.json" }).assistant.name, "Custom");
    assert.equal(loadAssistantConfig(dir, { ASSISTANT_CONFIG: custom }).assistant.name, "Custom");
    assert.equal(loadAssistantConfig(dir, { ASSISTANT_CONFIG: "   " }).assistant.name, "Default", "blank env value is ignored");

    write(ASSISTANT_CONFIG_LOCAL_FILE, named("Local"));
    assert.equal(resolveAssistantConfigPath(dir, { ASSISTANT_CONFIG: "custom.json" }), path.join(dir, ASSISTANT_CONFIG_LOCAL_FILE));
    assert.equal(loadAssistantConfig(dir, { ASSISTANT_CONFIG: "custom.json" }).assistant.name, "Local");
    assert.equal(loadAssistantConfig(dir, {}).assistant.name, "Local");
  });

  it("reads a file with a UTF-8 BOM (PowerShell's default)", () => {
    const file = write("bom.json", `﻿${JSON.stringify(named("Bom"))}`);
    assert.equal(readAssistantConfigFile(file).assistant.name, "Bom");
  });

  it("explains a missing or unparsable file", () => {
    const empty = fs.mkdtempSync(path.join(dir, "empty-"));
    assert.throws(() => loadAssistantConfig(empty, {}), /Cannot read assistant config .*assistant\.config\.json: .*copy assistant\.config\.example\.json/);
    const broken = write("broken.json", "{ not json");
    assert.throws(() => readAssistantConfigFile(broken), /broken\.json is not valid JSON: /);
    const invalid = write("invalid.json", { ...named("Invalid"), people: [{ initials: "AL", fullName: "Dup", divisionCode: null, email: null, role: null }] });
    assert.throws(() => readAssistantConfigFile(invalid), (err: unknown) => err instanceof AssistantConfigError && err.source === invalid && /owner's initials/.test(err.message));
  });
});
