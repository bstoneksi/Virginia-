/**
 * server/brief/email.ts — how the daily brief reaches Brandon's inbox.
 *
 * `EmailSender` is the one seam: `createResendSender` posts to Resend's REST API with the global
 * `fetch` (no SDK), `noopSender` only logs "email not configured". `createEmailSender(config)` picks
 * one from RESEND_API_KEY / BRIEF_EMAIL_FROM. Sending never throws out of the scheduler — the caller
 * (server/brief/run.ts) catches, logs and records the error in settings.
 *
 * Resend notes (resend.com): the free tier covers 100 emails a day. Its onboarding sender
 * `onboarding@resend.dev` works without any DNS setup but only delivers to the email address the
 * Resend account was signed up with — so Brandon signs up with bstone@teamksi.com, or verifies a
 * domain and sets BRIEF_EMAIL_FROM to an address on it.
 */
import type { Config } from "../config";

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text part. */
  text: string;
  /** HTML part. */
  html: string;
}

export interface EmailSendResult {
  /** False when no provider is configured (the noop sender). */
  sent: boolean;
  /** Provider message id when available. */
  id: string | null;
}

export interface EmailSender {
  /** True when a real provider is behind `send`. */
  readonly configured: boolean;
  /** One line for logs and the status endpoint, e.g. `Resend from Virginia <onboarding@resend.dev>`. */
  readonly description: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** A non-2xx answer from the provider; `message` carries the status and an excerpt of the body. */
export class EmailSendError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    const excerpt = body.replace(/\s+/g, " ").trim().slice(0, 300);
    super(`Resend responded ${status}: ${excerpt.length > 0 ? excerpt : "(empty body)"}`);
    this.name = "EmailSendError";
    this.status = status;
    this.body = body;
  }
}

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const DEFAULT_BRIEF_EMAIL_FROM = "Virginia <onboarding@resend.dev>";
export const DEFAULT_BRIEF_EMAIL_TO = "bstone@teamksi.com";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ResendSenderOptions {
  apiKey: string;
  /** `Name <address>` or a bare address; must be a verified domain or Resend's onboarding sender. */
  from: string;
  /** Injected for tests; defaults to the global fetch, looked up at call time. */
  fetch?: FetchLike;
  /** Abort the request after this long. Default 15 s. */
  timeoutMs?: number;
}

/**
 * POST https://api.resend.com/emails with `Authorization: Bearer <key>` and
 * `{ from, to: [to], subject, text, html }`. Resolves with Resend's message id; rejects with
 * `EmailSendError` on a non-2xx response (network failures reject with the fetch error).
 */
export function createResendSender(options: ResendSenderOptions): EmailSender {
  const apiKey = options.apiKey.trim();
  if (apiKey.length === 0) throw new Error("createResendSender needs an apiKey");
  const from = options.from.trim() || DEFAULT_BRIEF_EMAIL_FROM;
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 15_000;

  return {
    configured: true,
    description: `Resend from ${from}`,
    async send(message) {
      const res = await doFetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await res.text();
      if (!res.ok) throw new EmailSendError(res.status, body);
      let id: string | null = null;
      try {
        const parsed = JSON.parse(body) as { id?: unknown };
        if (typeof parsed.id === "string") id = parsed.id;
      } catch {
        /* a 2xx without JSON still counts as sent */
      }
      return { sent: true, id };
    },
  };
}

/** No provider: `send` logs one line and reports `sent: false`. */
export function createNoopSender(log: (line: string) => void = console.warn): EmailSender {
  return {
    configured: false,
    description: "email not configured (set RESEND_API_KEY)",
    async send(message) {
      log(`[brief] email not configured — "${message.subject}" for ${message.to} was not sent (set RESEND_API_KEY).`);
      return { sent: false, id: null };
    },
  };
}

export const noopSender: EmailSender = createNoopSender();

/** The sender the running config calls for: Resend when RESEND_API_KEY is set, otherwise the noop sender. */
export function createEmailSender(config: Pick<Config, "resendApiKey" | "briefEmailFrom">): EmailSender {
  if (config.resendApiKey === null) return noopSender;
  return createResendSender({ apiKey: config.resendApiKey, from: config.briefEmailFrom });
}
