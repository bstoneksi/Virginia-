import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmailSendError, RESEND_ENDPOINT, createEmailSender, createNoopSender, createResendSender, noopSender } from "./email";
import type { EmailMessage } from "./email";

const MESSAGE: EmailMessage = { to: "bstone@teamksi.com", subject: "Daily brief — Thu, Oct 1", text: "hi", html: "<p>hi</p>" };

type FetchStub = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Swap the global fetch for the duration of `fn` (the sender looks it up at call time). */
async function withFetchStub<T>(stub: FetchStub, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as unknown as { fetch: unknown };
  const original = g.fetch;
  g.fetch = stub;
  try {
    return await fn();
  } finally {
    g.fetch = original;
  }
}

describe("createResendSender", () => {
  it("POSTs to Resend with the bearer key and the message as JSON, returning the message id", async () => {
    const calls: { input: string; init: RequestInit }[] = [];
    const sender = createResendSender({
      apiKey: "re_test_123",
      from: "Virginia <onboarding@resend.dev>",
      fetch: async (input, init) => {
        calls.push({ input, init });
        return new Response(JSON.stringify({ id: "msg_1" }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    assert.equal(sender.configured, true);
    assert.equal(sender.description, "Resend from Virginia <onboarding@resend.dev>");

    const result = await sender.send(MESSAGE);
    assert.deepEqual(result, { sent: true, id: "msg_1" });

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.input, RESEND_ENDPOINT);
    assert.equal(call.input, "https://api.resend.com/emails");
    assert.equal(call.init.method, "POST");
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer re_test_123");
    assert.equal(headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(String(call.init.body)), {
      from: "Virginia <onboarding@resend.dev>",
      to: ["bstone@teamksi.com"],
      subject: "Daily brief — Thu, Oct 1",
      text: "hi",
      html: "<p>hi</p>",
    });
    assert.ok(call.init.signal instanceof AbortSignal, "requests carry a timeout signal");
  });

  it("throws an Error carrying the status and a body excerpt on a non-2xx answer", async () => {
    const body = { statusCode: 403, name: "validation_error", message: "You can only send testing emails to your own email address (bstone@teamksi.com)." };
    const sender = createResendSender({ apiKey: "k", from: "x@y.z", fetch: async () => new Response(JSON.stringify(body), { status: 403 }) });
    await assert.rejects(sender.send(MESSAGE), (err: unknown) => {
      assert.ok(err instanceof EmailSendError);
      assert.ok(err instanceof Error);
      assert.equal(err.status, 403);
      assert.match(err.message, /^Resend responded 403: /);
      assert.match(err.message, /only send testing emails to your own email address/);
      assert.equal(err.body, JSON.stringify(body));
      return true;
    });

    const long = createResendSender({ apiKey: "k", from: "x@y.z", fetch: async () => new Response("x".repeat(1000), { status: 500 }) });
    await assert.rejects(long.send(MESSAGE), (err: unknown) => {
      assert.ok(err instanceof EmailSendError);
      assert.ok(err.message.length < 400, "the excerpt is capped");
      return true;
    });

    const empty = createResendSender({ apiKey: "k", from: "x@y.z", fetch: async () => new Response("", { status: 401 }) });
    await assert.rejects(empty.send(MESSAGE), /Resend responded 401: \(empty body\)/);
  });

  it("propagates network failures and counts a 2xx without a JSON id as sent", async () => {
    const down = createResendSender({ apiKey: "k", from: "x@y.z", fetch: async () => Promise.reject(new TypeError("fetch failed")) });
    await assert.rejects(down.send(MESSAGE), /fetch failed/);

    const accepted = createResendSender({ apiKey: "k", from: "x@y.z", fetch: async () => new Response("", { status: 202 }) });
    assert.deepEqual(await accepted.send(MESSAGE), { sent: true, id: null });
  });

  it("uses the global fetch when none is injected, so a stubbed globalThis.fetch is honoured", async () => {
    const seen: string[] = [];
    const result = await withFetchStub(
      async (input) => {
        seen.push(String(input));
        return new Response('{"id":"g"}', { status: 200 });
      },
      () => createResendSender({ apiKey: "k", from: "a@b.c" }).send(MESSAGE),
    );
    assert.deepEqual(result, { sent: true, id: "g" });
    assert.deepEqual(seen, [RESEND_ENDPOINT]);
  });

  it("refuses an empty key and falls back to the default sender address", async () => {
    assert.throws(() => createResendSender({ apiKey: "  ", from: "a@b.c" }), /apiKey/);
    let from = "";
    const sender = createResendSender({
      apiKey: "k",
      from: "   ",
      fetch: async (_input, init) => {
        from = (JSON.parse(String(init.body)) as { from: string }).from;
        return new Response("{}", { status: 200 });
      },
    });
    await sender.send(MESSAGE);
    assert.equal(from, "Virginia <onboarding@resend.dev>");
  });
});

describe("noopSender / createEmailSender", () => {
  it("logs 'email not configured' and reports sent:false without touching the network", async () => {
    const lines: string[] = [];
    const sender = createNoopSender((line) => lines.push(line));
    assert.equal(sender.configured, false);
    assert.match(sender.description, /not configured/);
    const result = await sender.send(MESSAGE);
    assert.deepEqual(result, { sent: false, id: null });
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? "", /email not configured/);
    assert.match(lines[0] ?? "", /Daily brief — Thu, Oct 1/);
    assert.equal(noopSender.configured, false);
  });

  it("picks Resend when RESEND_API_KEY is set and the noop sender otherwise", () => {
    assert.equal(createEmailSender({ resendApiKey: null, briefEmailFrom: "x@y.z" }), noopSender);
    const resend = createEmailSender({ resendApiKey: "re_1", briefEmailFrom: "Virginia <v@teamksi.com>" });
    assert.equal(resend.configured, true);
    assert.equal(resend.description, "Resend from Virginia <v@teamksi.com>");
  });
});
