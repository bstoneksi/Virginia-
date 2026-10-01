import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { BRIEF_SECTION_LABELS, type DailyBriefPreview } from "@shared/types";
import { api, errorMessage } from "@/api";
import { Button } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { ErrorState } from "@/components/States";
import { useBootstrap } from "@/lib/bootstrap";
import { formatDateTime } from "@/lib/dates";
import { Markdown } from "@/lib/markdown";
import { useToast } from "@/lib/toast";
import { useQuery } from "@/lib/useQuery";

const WEEKDAYS_MON_FRI = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** "07:00" → "7:00 AM". */
export function formatBriefTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const hour = Number(m[1]);
  const minute = m[2] ?? "00";
  const suffix = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${suffix}`;
}

/** ["Mon", …, "Fri"] → "Mon–Fri"; all seven → "every day"; anything else is listed as is. */
export function formatBriefDays(days: readonly string[]): string {
  if (days.length === 7) return "every day";
  if (days.length === 5 && WEEKDAYS_MON_FRI.every((d) => days.includes(d))) return "Mon–Fri";
  return days.join(", ");
}

function Row({ label, children, tone = "normal" }: { label: string; children: ReactNode; tone?: "normal" | "error" }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="w-36 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500 sm:pt-0.5">{label}</dt>
      <dd className={`min-w-0 break-words text-sm ${tone === "error" ? "text-red-700" : "text-slate-800"}`}>{children}</dd>
    </div>
  );
}

/**
 * Settings → Daily brief: the schedule, what happened last, a dry-run preview and "Send now"
 * (SPEC §11). The schedule itself is server configuration (BRIEF_TIME / BRIEF_DAYS / RESEND_API_KEY),
 * so this tab shows it and explains how to change it rather than editing it.
 */
export function BriefSettings() {
  const { bootstrap } = useBootstrap();
  const toast = useToast();
  const status = useQuery((signal) => api.briefs.status(signal), []);
  const [preview, setPreview] = useState<DailyBriefPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);

  // Bootstrap already carries the schedule, so the banner renders before /api/briefs/status answers.
  const s = status.data;
  const time = s?.time ?? bootstrap.briefTime;
  const days = s?.days ?? bootstrap.briefDays;
  const emailConfigured = s?.emailConfigured ?? bootstrap.emailConfigured;
  const enabled = s?.enabled ?? true;
  const to = s?.to ?? "you";

  const showPreview = async () => {
    setPreviewing(true);
    try {
      setPreview(await api.briefs.preview());
      setPreviewOpen(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPreviewing(false);
    }
  };

  const sendNow = async () => {
    setSending(true);
    try {
      const result = await api.briefs.runDaily();
      if (result.emailed) toast.success(`Brief emailed to ${to} and saved to Briefs`);
      else if (result.emailError) toast.error(`Brief saved to Briefs, but the email failed: ${result.emailError}`);
      else toast.info("Brief saved to Briefs — not emailed (email is not set up)");
      setPreviewOpen(false);
      await status.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const sendLabel = emailConfigured ? "Send now" : "Generate now";

  return (
    <section className="flex flex-col gap-4">
      <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${enabled ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        <Icon name={enabled ? "clock" : "alert"} className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-medium">
            {enabled ? `Daily brief runs at ${formatBriefTime(time)}, ${formatBriefDays(days)} (America/Detroit)` : "The scheduled brief is turned off (BRIEF_ENABLED=0)"}
          </p>
          <p className="mt-0.5 text-xs opacity-80">
            {emailConfigured
              ? `Each brief is saved on the Briefs page and emailed to ${to}.`
              : enabled
                ? "Each brief is saved on the Briefs page. It is not emailed yet — see “Email delivery” below."
                : `You can still build one any time with “${sendLabel}”.`}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Status</h3>
        {status.error && !s && <ErrorState error={status.error} onRetry={() => void status.reload(false)} />}
        {!status.error && !s && <p className="mt-2 text-sm text-slate-500">Loading…</p>}
        {s && (
          <dl className="mt-1 divide-y divide-slate-100">
            <Row label="Last generated">{s.lastRunAt ? formatDateTime(s.lastRunAt) : "Not yet"}</Row>
            <Row label="Email">
              {s.emailConfigured ? (
                <>
                  Emailed to <span className="font-medium">{s.to}</span>
                  {s.lastEmailedAt ? ` · last sent ${formatDateTime(s.lastEmailedAt)}` : " · nothing sent yet"}
                </>
              ) : (
                <>Not set up — the brief stays in the app (RESEND_API_KEY is not set on the server).</>
              )}
            </Row>
            {s.lastEmailError && (
              <Row label="Last email error" tone="error">
                {s.lastEmailError}
              </Row>
            )}
            <Row label="Includes">
              {s.scope === "mine" ? "Only your own and unowned items (like Today)" : "Everyone's items, with owner initials"}
              {" · "}
              {s.sections ? s.sections.map((k) => BRIEF_SECTION_LABELS[k]).join(", ") : "all sections"}
            </Row>
          </dl>
        )}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" onClick={() => void showPreview()} disabled={previewing}>
            <Icon name="briefs" className="h-4 w-4" /> {previewing ? "Building preview…" : "Preview today's brief"}
          </Button>
          <Button variant="primary" onClick={() => void sendNow()} disabled={sending}>
            <Icon name="sparkle" className="h-4 w-4" /> {sending ? "Working…" : sendLabel}
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Preview builds the brief from the tracker without saving anything. “{sendLabel}” saves it to the{" "}
          <Link to="/briefs" className="font-medium text-brand underline">
            Briefs page
          </Link>
          {emailConfigured ? `, emails it to ${to}` : ""} and counts as today's scheduled run.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <h3 className="text-sm font-semibold text-slate-900">Email delivery</h3>
        {emailConfigured ? (
          <p className="mt-1">
            Email is on: the brief goes to <span className="font-medium">{to}</span> through Resend. Change the address with{" "}
            <code className="rounded bg-slate-100 px-1">BRIEF_EMAIL_TO</code>, the sender with <code className="rounded bg-slate-100 px-1">BRIEF_EMAIL_FROM</code> (a verified domain in Resend).
          </p>
        ) : (
          <>
            <p className="mt-1">
              The app emails the brief to you through <a href="https://resend.com" target="_blank" rel="noreferrer noopener" className="font-medium text-brand underline">Resend</a> — one message a day, to you only; nothing is sent on your behalf and the mailbox is never touched. No IT request is needed.
            </p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>
                Sign up at resend.com <strong>with {to}</strong> (Resend's starter sender only delivers to the address you sign up with).
              </li>
              <li>Create an API key (API Keys → Create).</li>
              <li>
                On the server (Railway → your service → Variables) set <code className="rounded bg-slate-100 px-1">RESEND_API_KEY</code> to that key. It redeploys on its own; this page then reads “Email is on”.
              </li>
            </ol>
            <p className="mt-2 text-xs text-slate-500">
              Optional: <code className="rounded bg-slate-100 px-1">BRIEF_EMAIL_TO</code> changes the recipient; <code className="rounded bg-slate-100 px-1">BRIEF_EMAIL_FROM</code> needs a domain verified in Resend (DNS records — that step does involve whoever manages the domain).
            </p>
          </>
        )}
      </div>

      <p className="text-xs text-slate-400">
        Schedule: <code>BRIEF_TIME</code> (24-hour, America/Detroit), <code>BRIEF_DAYS</code> (<code>weekdays</code>, <code>daily</code> or a list), <code>BRIEF_ENABLED=0</code> to pause,{" "}
        <code>BRIEF_SECTIONS</code> / <code>BRIEF_SCOPE</code> to trim the content. The Virginia project in Claude can also call <code>run_daily_brief</code>.
      </p>

      <Sheet
        open={previewOpen && preview !== null}
        onClose={() => setPreviewOpen(false)}
        variant="center"
        wide
        title={preview?.title ?? "Today's brief"}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void sendNow()} disabled={sending}>
              {sending ? "Working…" : sendLabel}
            </Button>
          </div>
        }
      >
        {preview && (
          <>
            <p className="mb-3 text-xs text-slate-500">This is what the brief would say right now. Nothing has been saved or sent.</p>
            <Markdown source={preview.bodyMd} />
          </>
        )}
      </Sheet>
    </section>
  );
}
