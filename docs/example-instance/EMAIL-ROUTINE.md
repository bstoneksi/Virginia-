# The email routine (separate from the app)

Status: **specified, not yet scheduled** — waiting on Brandon's answers to Q11 in `docs/SCOPE.md` (hours, delivery, draft categories) and on IT for write permissions.

## What the Microsoft 365 connector can do today

| Capability | Granted? | Consequence |
|---|---|---|
| Read mail, folders, flags (Mail.Read, MailboxItem.Read) | yes | Claude can build the digest |
| Read Teams meeting transcripts (OnlineMeetingTranscript.Read.All) | yes | meeting recaps can be pulled straight from Teams |
| Flag / move / mark mail (Mail.ReadWrite) | **no** | cannot flag to-dos yet |
| Create drafts (Mail.ReadWrite) | **no** | cannot leave drafts in the Drafts folder yet |
| Send mail (Mail.Send) | **no** | good — Brandon never wants AI to send |
| People directory (People.Read), Teams list (Team.ReadBasic.All) | no | roster is maintained in the app instead |

Ask for: **Mail.ReadWrite** only (consent by the Entra admin — Doug or Rob). Do **not** ask for Mail.Send.

## Phase 1 — read-only digest (possible now)

Schedule: every 2 hours, 7:00–18:00 America/Detroit, Monday–Friday (proposed; confirm).

Prompt for the routine (paste into the scheduled task once Q11 is confirmed):

> You are Virginia, Brandon Stone's executive assistant. Using the Microsoft 365 connector, read every email that arrived in Brandon's Inbox since the last run (fall back to the last 2 hours). Do not send, flag, move, draft or delete anything. Group what you read into: **Needs Brandon** (a question or request addressed to him with no reply from him yet), **FYI / informed** (CC, newsletters, automated notices, threads that resolved themselves), **Waiting on others** (Brandon asked, no answer yet), **Skip** (marketing, receipts). For each Needs-Brandon item give sender, brand/division if obvious (KSI K&B, Appliances, Henderson Glass, Paramount Fence, Riemer Floors, TrueScale, corporate), one-line ask, and a suggested one-line stance. Summarize FYI items in one line each so he never has to open them. Output Markdown with those four headings, newest first, under 400 words. If the Virginia tracker connector is available, call `add_brief` with kind `email_digest`, a title like "Inbox digest 9:00 AM", and the Markdown body; otherwise just return the Markdown.

Delivery: the digest lands in the app's **Briefs** page (via the MCP connector) and is also visible as the task's output in Claude.

## Phase 2 — flags and drafts (after Mail.ReadWrite)

Rules Brandon gave in the Sep 30 conversation, turned into policy:

1. **Never send.** Nothing in this routine may call a send action, ever.
2. **Flag** an email when it is a request addressed to Brandon that will take more than two minutes. Flagged = to-do, matching his existing habit. Never unflag or complete flags; he does that.
3. **Draft, never send** a reply only for these categories: thank-you / acknowledgment; scheduling confirmation or proposing times from his calendar; "received, will review by <date>"; forwarding to a direct report with a one-line ask. The draft sits in his Drafts folder; the digest lists "Drafts ready: N" so he can read and send or discard.
4. For everything else: summarize and suggest a stance in the digest; he writes the reply.
5. Proprietary or sensitive threads (legal, HR, compensation, acquisitions) are summarized only — no drafts.
6. Every action the routine takes (flag set, draft created) is listed at the bottom of that run's digest.

## Daily 7 am brief (built by the app — no IT needed)

Brandon's Round 1 answer to Q14: "I want a 7am brief on both the app and into my email." This brief is **not** part of the Claude routine above — the app builds it itself from the tracker (`server/brief/`), so it needs nothing from Microsoft 365 and nothing from IT.

**How it is built.** Every weekday at 07:00 America/Detroit (`BRIEF_TIME`, `BRIEF_DAYS`; `daily` for every day) the server assembles a Markdown brief: a greeting with the date and a one-line summary, then **Overdue** (owner initials, due date, days late), **Due today**, **Due this week** (the next six days), **High priority** items not already listed, **Needs an owner** (no owner, no brand), **Waiting for review** (pending captures), **Added yesterday** (Detroit calendar day) and **Latest email digest** — the newest `email_digest` brief of the last 24 hours quoted verbatim, so the Phase 1 routine above feeds straight into it, or "No digest yet". Empty sections say "Nothing." `BRIEF_SECTIONS` trims or reorders the sections; `BRIEF_SCOPE=mine` narrows the lists to Brandon's own and unowned items like the Today page. The result is stored on the **Briefs** page (kind *Daily brief*, title like "Daily brief — Thu, Oct 1"). If the server was asleep at 07:00 (a Railway redeploy, say) it catches up on its first check afterwards, and it never generates twice for one day. Any time: `GET /api/briefs/daily/preview` shows what it would say now, `POST /api/briefs/daily/run` generates and sends it, `GET /api/briefs/status` shows the schedule, the last run and the last email error — and the Virginia project in Claude can call the connector tool `run_daily_brief`.

**How it reaches email.** Through **Resend** (resend.com), a small transactional-email service: a REST API the server calls with one `fetch`, free tier of 100 emails a day (the brief uses one). Setup takes about five minutes and no IT: sign up at resend.com **with bstone@teamksi.com**, create an API key, set `RESEND_API_KEY` in Railway (it redeploys automatically). Until a domain is verified the sender stays Resend's onboarding address `onboarding@resend.dev` (the default `BRIEF_EMAIL_FROM`), which Resend delivers **only to the address the account was signed up with** — which is exactly the one address this brief goes to (`BRIEF_EMAIL_TO`). To send from an address like `virginia@teamksi.com` instead, add the DNS records Resend shows for teamksi.com (that step does need whoever manages the domain's DNS) and change `BRIEF_EMAIL_FROM`. Without `RESEND_API_KEY` the brief is simply not emailed: the Briefs page still gets it and the status reads "email not configured".

**Rules.** This is the one email the app ever sends: to Brandon only, about his own tracker, from the app's own sender. It never reads or touches the mailbox and never writes to anyone else (`BRIEF_EMAIL_TO` is a single address). A failed send is logged, shown in the status (`lastEmailError`) and the next day's brief tries again; the brief itself is always on the Briefs page. SPEC §0.3 ("the app never sends email") is to be read as "never on Brandon's behalf, never to others" — the deviation is Brandon's own request, recorded for SPEC §10.

## Later ideas
- Push the "Needs Brandon" items into the tracker as `A:` proposals (review screen, not direct items).
- Add the day's calendar to the 7 am brief (the brief itself is built — see above).
