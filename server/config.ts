import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  port: number;
  /** Absolute path to the data directory (SQLite db lives here). */
  dataDir: string;
  appPassword: string;
  sessionSecret: string;
  anthropicApiKey: string | null;
  anthropicModel: string;
  mcpToken: string | null;
  /** Local development only — skips the login requirement. */
  disableAuth: boolean;
  isProduction: boolean;
  version: string;
  /** Absolute path to the built client (client/dist). */
  clientDistDir: string;
  /** Absolute path to the repository root. */
  rootDir: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, "..");

function loadDotEnv(): void {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    // Node >= 21.7; does not override variables already present in the environment.
    process.loadEnvFile(envPath);
  } catch (err) {
    console.warn(`[config] could not load .env: ${(err as Error).message}`);
  }
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  loadDotEnv();
  const isProduction = env.NODE_ENV === "production";
  const disableAuth = env.DISABLE_AUTH === "1" || env.DISABLE_AUTH === "true";
  const appPassword = env.APP_PASSWORD ?? "";
  const sessionSecret = env.SESSION_SECRET ?? "";

  if (!disableAuth) {
    if (!appPassword || appPassword === "change-me") {
      throw new Error("APP_PASSWORD must be set to a real passphrase (or set DISABLE_AUTH=1 for local dev)");
    }
    if (sessionSecret.length < 16) {
      throw new Error("SESSION_SECRET must be at least 16 characters (or set DISABLE_AUTH=1 for local dev)");
    }
  }

  const dataDir = path.resolve(rootDir, env.DATA_DIR && env.DATA_DIR.length > 0 ? env.DATA_DIR : "./data");

  return {
    port: Number.parseInt(env.PORT ?? "3000", 10) || 3000,
    dataDir,
    appPassword,
    sessionSecret: sessionSecret || "dev-only-insecure-secret",
    anthropicApiKey: env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.length > 0 ? env.ANTHROPIC_API_KEY : null,
    anthropicModel: env.ANTHROPIC_MODEL && env.ANTHROPIC_MODEL.length > 0 ? env.ANTHROPIC_MODEL : "claude-opus-5-5",
    mcpToken: env.MCP_TOKEN && env.MCP_TOKEN.length > 0 ? env.MCP_TOKEN : null,
    disableAuth,
    isProduction,
    version: readVersion(),
    clientDistDir: path.join(rootDir, "client", "dist"),
    rootDir,
  };
}
