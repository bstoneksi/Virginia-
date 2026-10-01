/**
 * Test helpers (not a test file): a hand-built Config (never loadConfig), an in-memory database,
 * the Hono app from createApp() and a pre-authenticated session cookie. Requests go through
 * `app.request(...)` so no port is opened.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import type { Division, Person } from "../../shared/types";
import { createApp } from "../app";
import type { AppDeps } from "../app";
import { readAssistantConfigFile, toSeed } from "../assistantConfig";
import type { AssistantConfig } from "../assistantConfig";
import { SESSION_COOKIE, makeSessionCookieValue } from "../auth";
import type { Config } from "../config";
import { openDatabase } from "../db/index";
import type { Db } from "../db/index";
import { createRepo } from "../db/repo";
import type { Repo } from "../db/repo";
import type { SeedData } from "../db/seed";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

/**
 * The first instance's assistant.config.json (Brandon's), read directly — never the local override or
 * ASSISTANT_CONFIG — so every test sees the same owner, roster and divisions.
 */
export const exampleAssistantConfig: AssistantConfig = readAssistantConfigFile(path.join(repoRoot, "assistant.config.json"));
export const exampleSeed: SeedData = toSeed(exampleAssistantConfig);
export const exampleDivisions: Division[] = exampleSeed.divisions;
/** The seed people with the ids SQLite assigns (1-based, insertion order; the owner comes first). */
export const examplePeople: Person[] = exampleSeed.people.map((p, i) => ({ ...p, id: i + 1 }));

export const TEST_PASSWORD = "correct horse battery staple";
export const TEST_SECRET = "test-session-secret-0123456789";
export const TEST_MCP_TOKEN = "mcp-test-token-abcdef0123456789";

export function testConfig(overrides: Partial<Config> = {}): Config {
  const rootDir = path.resolve(here, "..", "..");
  return {
    port: 0,
    dataDir: ":memory:",
    appPassword: TEST_PASSWORD,
    sessionSecret: TEST_SECRET,
    anthropicApiKey: null,
    anthropicModel: "claude-opus-5-5",
    mcpToken: null,
    disableAuth: false,
    // true keeps hono/logger quiet; cookies stay non-Secure because app.request() targets localhost.
    isProduction: true,
    version: "test",
    clientDistDir: path.join(rootDir, "client", "dist"),
    rootDir,
    // Daily brief: scheduler off (tests call the routes / tick by hand), weekday defaults, no email provider.
    briefEnabled: false,
    briefTime: "07:00",
    briefDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    briefSections: null,
    briefScope: "all",
    resendApiKey: null,
    briefEmailTo: "bstone@teamksi.com",
    briefEmailFrom: "Virginia <onboarding@resend.dev>",
    assistant: exampleAssistantConfig,
    ...overrides,
  };
}

export interface TestApp {
  app: Hono;
  db: Db;
  repo: Repo;
  config: Config;
  /** `virginia_session=<id>.<sig>` for a valid session. */
  cookie: string;
}

export function makeTestApp(configOverrides: Partial<Config> = {}, deps: Partial<Omit<AppDeps, "config" | "db">> = {}): TestApp {
  const config = testConfig(configOverrides);
  const db = openDatabase(":memory:", { seed: exampleSeed });
  const app = createApp({ config, db, ...deps });
  const repo = createRepo(db);
  const session = repo.createSession();
  const cookie = `${SESSION_COOKIE}=${makeSessionCookieValue(session.id, config.sessionSecret)}`;
  return { app, db, repo, config, cookie };
}

/** Authenticated request. Plain objects are sent as JSON; FormData is sent as multipart. */
export async function call(
  t: TestApp,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const h: Record<string, string> = { cookie: t.cookie, ...headers };
  const init: RequestInit = { method, headers: h };
  if (body instanceof FormData) {
    init.body = body;
  } else if (typeof body === "string") {
    init.body = body;
    h["content-type"] ??= "application/json";
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    h["content-type"] = "application/json";
  }
  return t.app.request(url, init);
}

/** Unauthenticated request (no cookie). */
export async function anon(t: TestApp, method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json", ...headers };
  }
  return t.app.request(url, init);
}

export async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
