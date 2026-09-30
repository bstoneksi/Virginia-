/**
 * Authentication: single-user password login, HMAC-signed 90-day session cookie, MCP bearer token,
 * and the `requireAuth` middleware for /api/* and /mcp/* (docs/SPEC.md §0.4 and §4).
 *
 * Cookie format: `virginia_session=<sessionId>.<hmac-sha256(sessionId, SESSION_SECRET) hex>`.
 * The session row must also exist and be unexpired, so logout / purge invalidates cookies server-side.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config } from "./config";
import type { Repo } from "./db/repo";
import { SESSION_TTL_MS } from "./db/repo";
import { loginSchema, parseJsonBody } from "./lib/validate";

export const SESSION_COOKIE = "virginia_session";
export const LOGIN_FAILURE_DELAY_MS = 300;
/** Routes that never require credentials. */
export const AUTH_EXEMPT_PATHS: ReadonlySet<string> = new Set(["/api/health", "/api/auth/login"]);

export interface AuthDeps {
  config: Config;
  repo: Repo;
}

export type AuthVia = "disabled" | "cookie" | "bearer" | "path-token";

export interface AuthState {
  authenticated: boolean;
  via: AuthVia | null;
  sessionId: string | null;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time string comparison (via equal-length SHA-256 digests). */
export function safeEqualStrings(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

export function signSessionId(id: string, secret: string): string {
  return createHmac("sha256", secret).update(id, "utf8").digest("hex");
}

export function makeSessionCookieValue(id: string, secret: string): string {
  return `${id}.${signSessionId(id, secret)}`;
}

/** Verify the cookie's signature and return the session id, or null when tampered / malformed. */
export function parseSessionCookie(value: string | undefined, secret: string): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(signature)) return null;
  const expected = signSessionId(id, secret);
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) return null;
  return id;
}

/** True when `token` equals the configured MCP token (constant time). False when no token is configured. */
export function mcpTokenMatches(token: string | null | undefined, config: Config): boolean {
  if (!token || config.mcpToken === null) return false;
  return safeEqualStrings(token, config.mcpToken);
}

export function bearerToken(c: Context): string | null {
  const header = c.req.header("authorization");
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() ?? null;
}

/** The `:token` segment of a /mcp/:token request path (decoded), or null. */
export function pathToken(c: Context): string | null {
  const m = /^\/mcp\/([^/?#]+)/.exec(c.req.path);
  const raw = m?.[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Secure cookies on https (direct or behind a proxy) or in production — never for localhost. */
export function shouldUseSecureCookie(c: Context, config: Config): boolean {
  const url = new URL(c.req.url);
  const hostHeader = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
  const hostname = (hostHeader.split(",")[0] ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "::1") {
    return false;
  }
  const proto = (c.req.header("x-forwarded-proto") ?? url.protocol.replace(":", "")).split(",")[0]?.trim().toLowerCase();
  return proto === "https" || config.isProduction;
}

// ---------------------------------------------------------------------------
// Auth state + middleware
// ---------------------------------------------------------------------------

export function getAuthState(c: Context, deps: AuthDeps): AuthState {
  if (deps.config.disableAuth) return { authenticated: true, via: "disabled", sessionId: null };
  const sessionId = parseSessionCookie(getCookie(c, SESSION_COOKIE), deps.config.sessionSecret);
  if (sessionId !== null && deps.repo.getSession(sessionId) !== null) {
    return { authenticated: true, via: "cookie", sessionId };
  }
  if (mcpTokenMatches(bearerToken(c), deps.config)) return { authenticated: true, via: "bearer", sessionId: null };
  if (c.req.path.startsWith("/mcp/") && mcpTokenMatches(pathToken(c), deps.config)) {
    return { authenticated: true, via: "path-token", sessionId: null };
  }
  return { authenticated: false, via: null, sessionId: null };
}

/**
 * Middleware for `/api/*` and `/mcp/*`. Accepts a valid session cookie, `Authorization: Bearer <MCP_TOKEN>`
 * or (under /mcp) a matching path token. No-op when `config.disableAuth` is set. Otherwise 401 JSON.
 */
export function requireAuth(deps: AuthDeps): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    if (AUTH_EXEMPT_PATHS.has(path)) return next();
    if (getAuthState(c, deps).authenticated) return next();
    // /mcp/* with no MCP_TOKEN configured: let the route answer 503 "MCP not configured".
    if (path.startsWith("/mcp") && deps.config.mcpToken === null) return next();
    return c.json({ error: "Unauthorized" }, 401);
  };
}

// ---------------------------------------------------------------------------
// Routes: POST /auth/login, POST /auth/logout, GET /auth/me (mounted under /api)
// ---------------------------------------------------------------------------

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function authRouter(deps: AuthDeps): Hono {
  const { config, repo } = deps;
  const router = new Hono();

  router.post("/auth/login", async (c) => {
    const { password } = await parseJsonBody(c, loginSchema);
    const ok = config.disableAuth || (config.appPassword.length > 0 && safeEqualStrings(password, config.appPassword));
    if (!ok) {
      await delay(LOGIN_FAILURE_DELAY_MS);
      return c.json({ error: "Invalid password" }, 401);
    }
    repo.purgeExpiredSessions();
    const session = repo.createSession(SESSION_TTL_MS);
    setCookie(c, SESSION_COOKIE, makeSessionCookieValue(session.id, config.sessionSecret), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      secure: shouldUseSecureCookie(c, config),
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return c.body(null, 204);
  });

  router.post("/auth/logout", (c) => {
    const sessionId = parseSessionCookie(getCookie(c, SESSION_COOKIE), config.sessionSecret);
    if (sessionId !== null) repo.deleteSession(sessionId);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  router.get("/auth/me", (c) => c.json({ authenticated: getAuthState(c, deps).authenticated }));

  return router;
}
