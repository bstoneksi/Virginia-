/**
 * scripts/apply-config.mjs — the pure transforms (manifest + index.html) and the script end to end on a
 * temp copy of the static files. Never touches the real client/ files.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { INDEX_HTML_FILE, MANIFEST_FILE, applyConfig, applyIndexHtml, applyManifest, readConfig, resolveConfigPath, staticValues } from "../scripts/apply-config.mjs";
import type { StaticConfig } from "../scripts/apply-config.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootDir, "scripts", "apply-config.mjs");

const ada: StaticConfig = {
  assistant: { name: "Ada", tagline: "Executive assistant tracker" },
  owner: { fullName: "Ada Lovelace" },
  branding: { themeColor: "#112233" },
};

const INDEX_WITHOUT_DESCRIPTION = [
  "<!doctype html>",
  '<html lang="en">',
  "  <head>",
  '    <meta charset="UTF-8" />',
  '    <meta name="theme-color" content="#000000" />',
  '    <meta name="apple-mobile-web-app-title" content="Old" />',
  "    <title>Old</title>",
  "  </head>",
  "  <body></body>",
  "</html>",
  "",
].join("\n");

const MANIFEST = `${JSON.stringify(
  {
    name: "Old",
    short_name: "Old",
    description: "Someone's tracker",
    start_url: "/",
    display: "standalone",
    theme_color: "#000000",
    icons: [{ src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" }],
  },
  null,
  2,
)}\n`;

describe("apply-config: transforms", () => {
  it("staticValues: the description is the owner's tagline", () => {
    assert.deepEqual(staticValues(ada), { name: "Ada", description: "Ada Lovelace's Executive assistant tracker", themeColor: "#112233" });
    assert.throws(() => staticValues({ ...ada, owner: { fullName: "  " } }), /owner\.fullName must be a non-empty string/);
  });

  it("applyManifest rewrites name, short_name, description and theme_color, keeps the rest and the key order, and is idempotent", () => {
    const out = applyManifest(MANIFEST, ada);
    const next = JSON.parse(out) as Record<string, unknown>;
    assert.equal(next.name, "Ada");
    assert.equal(next.short_name, "Ada");
    assert.equal(next.description, "Ada Lovelace's Executive assistant tracker");
    assert.equal(next.theme_color, "#112233");
    assert.equal(next.display, "standalone");
    assert.deepEqual(Object.keys(next), Object.keys(JSON.parse(MANIFEST) as object));
    assert.ok(out.endsWith("}\n"));
    assert.equal(applyManifest(out, ada), out);
  });

  it("applyIndexHtml rewrites <title> and the metas, inserts a missing description before <title>, and is idempotent", () => {
    const out = applyIndexHtml(INDEX_WITHOUT_DESCRIPTION, ada);
    assert.match(out, /<title>Ada<\/title>/);
    assert.match(out, /<meta name="apple-mobile-web-app-title" content="Ada" \/>/);
    assert.match(out, /<meta name="theme-color" content="#112233" \/>/);
    assert.match(out, /\n    <meta name="description" content="Ada Lovelace's Executive assistant tracker" \/>\n    <title>Ada<\/title>/);
    assert.equal(out.match(/<meta name="description"/g)?.length, 1);
    assert.equal(applyIndexHtml(out, ada), out);
    // A second config replaces the inserted description in place.
    const again = applyIndexHtml(out, { ...ada, owner: { fullName: "Grace Hopper" } });
    assert.match(again, /content="Grace Hopper's Executive assistant tracker"/);
    assert.equal(again.match(/<meta name="description"/g)?.length, 1);
  });

  it("applyIndexHtml escapes HTML in the values and keeps CRLF line endings", () => {
    const crlf = INDEX_WITHOUT_DESCRIPTION.replace(/\n/g, "\r\n");
    const out = applyIndexHtml(crlf, { ...ada, assistant: { name: 'Ada & "Co" <x>', tagline: "Tracker" } });
    assert.match(out, /<title>Ada &amp; &quot;Co&quot; &lt;x&gt;<\/title>/);
    assert.match(out, /content="Ada &amp; &quot;Co&quot; &lt;x&gt;" \/>/);
    assert.match(out, /<meta name="description" content="Ada Lovelace's Tracker" \/>\r\n    <title>/);
    assert.ok(!/[^\r]\n/.test(out), "every line ending stays CRLF");
  });

  it("applyIndexHtml refuses a page without a <title>", () => {
    assert.throws(() => applyIndexHtml("<html><head></head></html>", ada), /has no <title> element/);
  });
});

describe("apply-config: the checked-in files", () => {
  it("client/index.html and the manifest already match assistant.config.json (run `npm run config:apply` after editing it)", () => {
    const config = readConfig(path.join(rootDir, "assistant.config.json"));
    const manifest = fs.readFileSync(path.join(rootDir, MANIFEST_FILE), "utf8");
    const html = fs.readFileSync(path.join(rootDir, INDEX_HTML_FILE), "utf8");
    assert.equal(applyManifest(manifest, config), manifest);
    assert.equal(applyIndexHtml(html, config), html);
  });
});

describe("apply-config: on a temp copy of the repo", () => {
  let dir = "";
  const manifestFile = (): string => path.join(dir, ...MANIFEST_FILE.split("/"));
  const indexFile = (): string => path.join(dir, ...INDEX_HTML_FILE.split("/"));

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-config-"));
    fs.mkdirSync(path.dirname(manifestFile()), { recursive: true });
    fs.writeFileSync(manifestFile(), MANIFEST);
    fs.writeFileSync(indexFile(), INDEX_WITHOUT_DESCRIPTION);
    fs.writeFileSync(path.join(dir, "assistant.config.json"), JSON.stringify(ada, null, 2));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolves the config like the server: assistant.config.json → ASSISTANT_CONFIG → assistant.config.local.json", () => {
    assert.equal(resolveConfigPath(dir, {}), path.join(dir, "assistant.config.json"));
    assert.equal(resolveConfigPath(dir, { ASSISTANT_CONFIG: "other.json" }), path.join(dir, "other.json"));
    assert.equal(resolveConfigPath(dir, { ASSISTANT_CONFIG: "  " }), path.join(dir, "assistant.config.json"));
    fs.writeFileSync(path.join(dir, "assistant.config.local.json"), JSON.stringify(ada));
    try {
      assert.equal(resolveConfigPath(dir, { ASSISTANT_CONFIG: "other.json" }), path.join(dir, "assistant.config.local.json"));
    } finally {
      fs.rmSync(path.join(dir, "assistant.config.local.json"));
    }
  });

  it("writes both files once, then reports nothing to change; --check never writes", () => {
    const first = applyConfig(dir, {});
    assert.equal(first.configPath, path.join(dir, "assistant.config.json"));
    assert.deepEqual(first.changed, [MANIFEST_FILE, INDEX_HTML_FILE]);
    assert.match(fs.readFileSync(indexFile(), "utf8"), /<title>Ada<\/title>/);
    assert.equal((JSON.parse(fs.readFileSync(manifestFile(), "utf8")) as { name: string }).name, "Ada");

    assert.deepEqual(applyConfig(dir, {}).changed, []);

    const grace = path.join(dir, "grace.json");
    fs.writeFileSync(grace, JSON.stringify({ ...ada, assistant: { name: "Grace", tagline: "Tracker" } }));
    const before = fs.readFileSync(indexFile(), "utf8");
    const check = applyConfig(dir, { ASSISTANT_CONFIG: grace }, { check: true });
    assert.deepEqual(check.changed, [MANIFEST_FILE, INDEX_HTML_FILE]);
    assert.equal(fs.readFileSync(indexFile(), "utf8"), before, "--check must not write");
  });

  it("runs as a CLI (`node scripts/apply-config.mjs --root <dir>`) and exits 1 on a bad config", () => {
    const run = (...args: string[]) => spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8", env: { ...process.env, ASSISTANT_CONFIG: "" } });
    const ok = run("--root", dir);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /\[config:apply\] assistant\.config\.json: "Ada" - static files already up to date/);

    fs.writeFileSync(path.join(dir, "assistant.config.json"), JSON.stringify({ ...ada, assistant: { name: "Grace", tagline: "Tracker" } }));
    const check = run("--root", dir, "--check");
    assert.equal(check.status, 1);
    assert.match(check.stderr, /out of date: client\/public\/manifest\.webmanifest, client\/index\.html/);
    const apply = run("--root", dir);
    assert.equal(apply.status, 0, apply.stderr);
    assert.match(apply.stdout, /"Grace" - updated client\/public\/manifest\.webmanifest, client\/index\.html/);

    fs.writeFileSync(path.join(dir, "assistant.config.json"), "{ nope");
    const bad = run("--root", dir);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /is not valid JSON/);
  });
});
