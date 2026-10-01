#!/usr/bin/env node
/**
 * scripts/apply-config.mjs — stamp the static client files from assistant.config.json.
 *
 * Rewrites client/public/manifest.webmanifest (name, short_name, description, theme_color) and
 * client/index.html (<title>, apple-mobile-web-app-title, theme-color and description metas) so the
 * installed PWA, the browser tab and the login page carry the configured assistant name before any
 * JavaScript runs. Idempotent: a file is only written when its content would change.
 *
 * Runs automatically before `npm run dev` and `npm run build` (predev / prebuild); by hand:
 *   npm run config:apply
 *   node scripts/apply-config.mjs [--root <repo dir>] [--check]     (--check: exit 1 when out of date)
 *
 * Config resolution mirrors server/assistantConfig.ts: assistant.config.local.json (when present) →
 * $ASSISTANT_CONFIG (absolute, or relative to the repo root) → assistant.config.json.
 *
 * Plain Node ESM, no dependencies. The transforms are exported so server/applyConfig.test.ts can
 * exercise them without touching the real files (types in apply-config.d.mts).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_FILE = "assistant.config.json";
export const LOCAL_CONFIG_FILE = "assistant.config.local.json";
export const CONFIG_ENV = "ASSISTANT_CONFIG";
export const MANIFEST_FILE = "client/public/manifest.webmanifest";
export const INDEX_HTML_FILE = "client/index.html";

/** Same order as server/assistantConfig.ts: local override → $ASSISTANT_CONFIG → the committed file. */
export function resolveConfigPath(rootDir, env = process.env) {
  const local = path.join(rootDir, LOCAL_CONFIG_FILE);
  if (fs.existsSync(local)) return local;
  const fromEnv = typeof env[CONFIG_ENV] === "string" ? env[CONFIG_ENV].trim() : "";
  if (fromEnv) return path.resolve(rootDir, fromEnv);
  return path.join(rootDir, CONFIG_FILE);
}

function requireString(config, dotted) {
  const value = dotted.split(".").reduce((o, key) => (o && typeof o === "object" ? o[key] : undefined), config);
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${dotted} must be a non-empty string`);
  return value.trim();
}

/** Read the config and check only the fields the static files need (the server validates everything else). */
export function readConfig(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(`cannot read ${file}: ${err.message}`);
  }
  let config;
  try {
    config = JSON.parse(text.replace(/^﻿/, ""));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(`${file} must contain a JSON object`);
  staticValues(config);
  return config;
}

/** The values stamped into the static files. */
export function staticValues(config) {
  const name = requireString(config, "assistant.name");
  const tagline = requireString(config, "assistant.tagline");
  const owner = requireString(config, "owner.fullName");
  const themeColor = requireString(config, "branding.themeColor");
  return { name, description: `${owner}'s ${tagline}`, themeColor };
}

/**
 * manifest.webmanifest text → text with name / short_name / description / theme_color from the config.
 * Existing top-level keys are replaced in place (the file keeps its formatting); only when one of the
 * four keys is missing is the manifest re-serialized with two-space indentation.
 */
export function applyManifest(text, config) {
  const values = staticValues(config);
  const source = text.replace(/^﻿/, "");
  const manifest = JSON.parse(source);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`${MANIFEST_FILE} must contain a JSON object`);
  const updates = { name: values.name, short_name: values.name, description: values.description, theme_color: values.themeColor };

  // Top-level keys sit at the indentation of the first key line after the opening brace; nested keys are deeper.
  const indent = /\{[ \t]*\r?\n([ \t]*)"/.exec(source)?.[1];
  if (indent !== undefined && Object.keys(updates).every((key) => Object.hasOwn(manifest, key))) {
    let out = source;
    for (const [key, value] of Object.entries(updates)) {
      const pattern = new RegExp(`^(${indent}"${key}"[ \\t]*:[ \\t]*)"(?:[^"\\\\]|\\\\.)*"`, "m");
      out = out.replace(pattern, (_match, open) => `${open}${JSON.stringify(value)}`);
    }
    try {
      const check = JSON.parse(out);
      if (Object.entries(updates).every(([key, value]) => check[key] === value)) return out;
    } catch {
      /* unusual formatting — fall through to re-serializing */
    }
  }
  return `${JSON.stringify({ ...manifest, ...updates }, null, 2)}\n`;
}

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function metaPattern(name) {
  return new RegExp(`(<meta\\s+name="${name}"\\s+content=")([^"]*)(")`);
}

/** Replace a <meta name=…> content, or insert the tag on its own line right before <title> when missing. */
function upsertMeta(html, name, content, eol) {
  const value = escapeHtml(content);
  const pattern = metaPattern(name);
  if (pattern.test(html)) return html.replace(pattern, (_match, open, _old, close) => `${open}${value}${close}`);
  const title = /^([ \t]*)<title>/m.exec(html);
  if (!title) throw new Error(`${INDEX_HTML_FILE} has no <title> element`);
  return `${html.slice(0, title.index)}${title[1]}<meta name="${name}" content="${value}" />${eol}${html.slice(title.index)}`;
}

/** index.html text → text with <title>, apple-mobile-web-app-title, theme-color and description from the config. */
export function applyIndexHtml(html, config) {
  const values = staticValues(config);
  const eol = html.includes("\r\n") ? "\r\n" : "\n";
  if (!/<title>[^<]*<\/title>/.test(html)) throw new Error(`${INDEX_HTML_FILE} has no <title> element`);
  let out = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(values.name)}</title>`);
  out = upsertMeta(out, "apple-mobile-web-app-title", values.name, eol);
  out = upsertMeta(out, "theme-color", values.themeColor, eol);
  out = upsertMeta(out, "description", values.description, eol);
  return out;
}

/**
 * Apply the resolved config to the static files under `rootDir`. Returns the config path, the config
 * and the files that were (or, with `check`, would be) rewritten.
 */
export function applyConfig(rootDir, env = process.env, options = {}) {
  const check = options.check === true;
  const configPath = resolveConfigPath(rootDir, env);
  const config = readConfig(configPath);
  const changed = [];
  const targets = [
    [MANIFEST_FILE, applyManifest],
    [INDEX_HTML_FILE, applyIndexHtml],
  ];
  for (const [relative, transform] of targets) {
    const file = path.join(rootDir, ...relative.split("/"));
    const before = fs.readFileSync(file, "utf8");
    const after = transform(before, config);
    if (after === before) continue;
    if (!check) fs.writeFileSync(file, after, "utf8");
    changed.push(relative);
  }
  return { configPath, config, changed };
}

function parseArgs(argv) {
  const args = { root: null, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") args.check = true;
    else if (arg === "--root") {
      i += 1;
      args.root = argv[i] ?? null;
      if (args.root === null) throw new Error("--root needs a directory");
    } else if (arg.startsWith("--root=")) args.root = arg.slice("--root=".length);
    else throw new Error(`unknown argument ${arg}`);
  }
  return args;
}

function isMain() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const entry = path.resolve(process.argv[1]);
  return process.platform === "win32" ? self.toLowerCase() === entry.toLowerCase() : self === entry;
}

if (isMain()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const rootDir = args.root ? path.resolve(args.root) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const { configPath, config, changed } = applyConfig(rootDir, process.env, { check: args.check });
    const name = staticValues(config).name;
    const shown = path.relative(rootDir, configPath) || configPath;
    if (changed.length === 0) {
      console.log(`[config:apply] ${shown}: "${name}" - static files already up to date`);
    } else if (args.check) {
      console.error(`[config:apply] ${shown}: "${name}" - out of date: ${changed.join(", ")} (run: npm run config:apply)`);
      process.exit(1);
    } else {
      console.log(`[config:apply] ${shown}: "${name}" - updated ${changed.join(", ")}`);
    }
  } catch (err) {
    console.error(`[config:apply] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
