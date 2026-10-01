import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../config";

describe("loadConfig — daily brief variables", () => {
  it("defaults to 07:00 Mon–Fri, every section, everyone's items, no email provider", () => {
    const c = loadConfig({ DISABLE_AUTH: "1" });
    assert.equal(c.briefEnabled, true);
    assert.equal(c.briefTime, "07:00");
    assert.deepEqual(c.briefDays, ["Mon", "Tue", "Wed", "Thu", "Fri"]);
    assert.equal(c.briefSections, null);
    assert.equal(c.briefScope, "all");
    assert.equal(c.resendApiKey, null);
    assert.equal(c.briefEmailTo, "bstone@teamksi.com");
    assert.equal(c.briefEmailFrom, "Virginia <onboarding@resend.dev>");
  });

  it("reads every override", () => {
    const c = loadConfig({
      DISABLE_AUTH: "1",
      BRIEF_ENABLED: "0",
      BRIEF_TIME: "6:30",
      BRIEF_DAYS: "daily",
      BRIEF_SECTIONS: "overdue, digest",
      BRIEF_SCOPE: "mine",
      RESEND_API_KEY: " re_live_x ",
      BRIEF_EMAIL_TO: "brandon@teamksi.com",
      BRIEF_EMAIL_FROM: "Virginia <virginia@teamksi.com>",
    });
    assert.equal(c.briefEnabled, false);
    assert.equal(c.briefTime, "06:30");
    assert.equal(c.briefDays.length, 7);
    assert.deepEqual(c.briefSections, ["overdue", "digest"]);
    assert.equal(c.briefScope, "mine");
    assert.equal(c.resendApiKey, "re_live_x");
    assert.equal(c.briefEmailTo, "brandon@teamksi.com");
    assert.equal(c.briefEmailFrom, "Virginia <virginia@teamksi.com>");
    assert.equal(loadConfig({ DISABLE_AUTH: "1", BRIEF_ENABLED: "false" }).briefEnabled, false);
    assert.equal(loadConfig({ DISABLE_AUTH: "1", BRIEF_ENABLED: "yes" }).briefEnabled, true);
    assert.equal(loadConfig({ DISABLE_AUTH: "1", RESEND_API_KEY: "" }).resendApiKey, null);
  });

  it("fails at boot on a typo instead of silently running at the wrong time", () => {
    assert.throws(() => loadConfig({ DISABLE_AUTH: "1", BRIEF_TIME: "25:00" }), /BRIEF_TIME/);
    assert.throws(() => loadConfig({ DISABLE_AUTH: "1", BRIEF_DAYS: "Funday" }), /BRIEF_DAYS/);
    assert.throws(() => loadConfig({ DISABLE_AUTH: "1", BRIEF_SECTIONS: "overdue,nope" }), /BRIEF_SECTIONS/);
    assert.throws(() => loadConfig({ DISABLE_AUTH: "1", BRIEF_SCOPE: "team" }), /BRIEF_SCOPE/);
    assert.throws(() => loadConfig({ DISABLE_AUTH: "1", BRIEF_EMAIL_TO: "not-an-email" }), /BRIEF_EMAIL_TO/);
  });
});
