import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyDraft } from "../../shared/types";
import type { Bootstrap, Brief } from "../../shared/types";
import { BRIEF_SETTING_KEYS } from "../brief/run";
import type { DailyBriefRunResult, DailyBriefStatus } from "../brief/run";
import { todayISO } from "../db/index";
import { anon, call, json, makeTestApp } from "../lib/testing";
import type { DailyBriefPreview } from "./briefs";

type FetchStub = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** The Resend sender uses the global fetch at call time; swap it for the duration of `fn`. */
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

describe("daily brief routes", () => {
  it("GET /api/briefs/status reports the schedule before any run", async () => {
    const t = makeTestApp();
    const res = await call(t, "GET", "/api/briefs/status");
    assert.equal(res.status, 200);
    const status = await json<DailyBriefStatus>(res);
    assert.deepEqual(status, {
      enabled: false,
      time: "07:00",
      days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      sections: null,
      scope: "all",
      lastRunDate: null,
      lastRunAt: null,
      lastEmailError: null,
      lastEmailedAt: null,
      emailConfigured: false,
      to: "bstone@teamksi.com",
    });
  });

  it("GET /api/briefs/daily/preview builds today's brief without storing or emailing anything", async () => {
    const t = makeTestApp();
    t.repo.createItem(emptyDraft({ title: "Late glass quote", ownerInitials: "VM", divisionCode: "HG", dueDate: "2020-01-01" }));
    const res = await call(t, "GET", "/api/briefs/daily/preview");
    assert.equal(res.status, 200);
    const preview = await json<DailyBriefPreview>(res);
    assert.match(preview.title, /^Daily brief — [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/);
    assert.ok(preview.bodyMd.includes("## Overdue (1)\n- Late glass quote — VM · HG · due Jan 1, 2020 ("), preview.bodyMd);
    assert.ok(preview.html.startsWith("<!doctype html>"));
    assert.ok(preview.html.includes("Late glass quote"));
    assert.ok(preview.plainText.startsWith(`${preview.title}\n`));
    assert.deepEqual(t.repo.listBriefs(), [], "a preview stores nothing");
    assert.equal(t.repo.getSetting(BRIEF_SETTING_KEYS.lastRunDate), null, "a preview is not a run");
  });

  it("POST /api/briefs/daily/run stores a daily brief and reports emailed:false without a provider", async () => {
    const t = makeTestApp();
    const res = await call(t, "POST", "/api/briefs/daily/run");
    assert.equal(res.status, 200);
    const result = await json<DailyBriefRunResult>(res);
    assert.equal(result.brief.kind, "daily");
    assert.match(result.brief.title, /^Daily brief — /);
    assert.equal(result.emailed, false);
    assert.equal(result.emailError, null);

    const listed = await json<Brief[]>(await call(t, "GET", "/api/briefs"));
    assert.deepEqual(listed.map((b) => b.id), [result.brief.id]);

    const status = await json<DailyBriefStatus>(await call(t, "GET", "/api/briefs/status"));
    assert.equal(status.lastRunDate, todayISO());
    assert.match(status.lastRunAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(status.lastEmailError, null);
    assert.equal(status.lastEmailedAt, null);
    assert.equal(status.emailConfigured, false);
  });

  it("POST /api/briefs/daily/run emails through Resend when RESEND_API_KEY is set", async () => {
    const t = makeTestApp({ resendApiKey: "re_test_key", briefEmailTo: "brandon@example.com", briefEmailFrom: "Virginia <v@example.com>" });
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const result = await withFetchStub(
      async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(JSON.stringify({ id: "msg_42" }), { status: 200 });
      },
      () => call(t, "POST", "/api/briefs/daily/run").then((res) => json<DailyBriefRunResult>(res)),
    );
    assert.equal(result.emailed, true);
    assert.equal(result.emailError, null);
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.ok(request);
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal((request.init?.headers as Record<string, string>).authorization, "Bearer re_test_key");
    const body = JSON.parse(String(request.init?.body)) as { from: string; to: string[]; subject: string; text: string; html: string };
    assert.equal(body.from, "Virginia <v@example.com>");
    assert.deepEqual(body.to, ["brandon@example.com"]);
    assert.equal(body.subject, result.brief.title);
    assert.ok(body.text.startsWith(`${result.brief.title}\n`));
    assert.ok(body.html.includes("<h1"));

    const status = await json<DailyBriefStatus>(await call(t, "GET", "/api/briefs/status"));
    assert.equal(status.emailConfigured, true);
    assert.equal(status.to, "brandon@example.com");
    assert.ok(status.lastEmailedAt);
    assert.equal(status.lastEmailError, null);
  });

  it("records a failed email in status and still stores the brief", async () => {
    const t = makeTestApp({ resendApiKey: "re_test_key" });
    const result = await withFetchStub(
      async () => new Response(JSON.stringify({ statusCode: 403, message: "You can only send testing emails to your own email address" }), { status: 403 }),
      () => call(t, "POST", "/api/briefs/daily/run").then((res) => json<DailyBriefRunResult>(res)),
    );
    assert.equal(result.emailed, false);
    assert.match(result.emailError ?? "", /^Resend responded 403: .*only send testing emails/);
    assert.equal(t.repo.listBriefs().length, 1);
    const status = await json<DailyBriefStatus>(await call(t, "GET", "/api/briefs/status"));
    assert.equal(status.lastEmailError, result.emailError);
    assert.equal(status.lastRunDate, todayISO());
  });

  it("GET /api/bootstrap carries emailConfigured, briefTime and briefDays for the Settings page", async () => {
    const plain = await json<Bootstrap>(await call(makeTestApp(), "GET", "/api/bootstrap"));
    assert.equal(plain.emailConfigured, false);
    assert.equal(plain.briefTime, "07:00");
    assert.deepEqual(plain.briefDays, ["Mon", "Tue", "Wed", "Thu", "Fri"]);

    const tuned = makeTestApp({ resendApiKey: "re_x", briefTime: "06:30", briefDays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] });
    const body = await json<Bootstrap>(await call(tuned, "GET", "/api/bootstrap"));
    assert.equal(body.emailConfigured, true);
    assert.equal(body.briefTime, "06:30");
    assert.equal(body.briefDays.length, 7);
  });

  it("keeps every daily-brief route behind the login", async () => {
    const t = makeTestApp();
    assert.equal((await anon(t, "GET", "/api/briefs/status")).status, 401);
    assert.equal((await anon(t, "GET", "/api/briefs/daily/preview")).status, 401);
    assert.equal((await anon(t, "POST", "/api/briefs/daily/run")).status, 401);
    assert.equal(t.repo.listBriefs().length, 0);
  });
});
