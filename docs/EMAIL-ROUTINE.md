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

## Later ideas
- Push the "Needs Brandon" items into the tracker as `A:` proposals (review screen, not direct items).
- Daily 7:00 brief combining Today view + calendar + the overnight digest.
