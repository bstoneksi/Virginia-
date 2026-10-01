# Decision log

Running record of product decisions for this instance. Newest at the bottom. The questions themselves live in `docs/example-instance/SCOPE.md` §3 (Round 1) and the HTML decision pages under `docs/example-instance/`.

## 2026-09-30 — Round 1 assumptions (made without Brandon, see SCOPE.md §3)

All fifteen recommended answers were used to build v1.

## 2026-10-01 — Round 1 answers from Brandon

| # | Topic | Answer | Status |
|---|---|---|---|
| Q1 | Hosting | Railway, one service + volume, under the KSI email | Confirmed as built |
| Q2 | Login | One passphrase, devices stay signed in ~90 days | Confirmed as built |
| Q3 | Captures | Both in-app and through the Claude project connector | Confirmed as built |
| Q4 | Statuses | Open · In Progress · Parked · Done | Confirmed as built |
| Q5 | Tags | Keep A/Q/I/D/W/NB; Parking Lot = Parked status | Confirmed as built |
| Q6 | Board layout | Accepted columns-by-status **and** wants the person/brand view ("c") as the primary way he looks at work outside his own items. Asked whether a filter gives the person/brand layout. | **Built 2026-10-01**: Board → *Group by* None · Brand · Person (swimlanes; filters still apply on top; the choice is remembered per browser). Default stays *None* until Round 2 R1 is answered. In the Person view Brandon's own lane holds his cards and the unowned ones (a blank owner means him) and comes last, since this view is for other people's work. |
| Q7 | Landing page | Today on phone, Board on desktop | Confirmed as built |
| Q8 | Sharing | Copy/print agenda now; live pages later | Confirmed as built |
| Q9 | Untagged lines | Inferred, marked for review | Confirmed as built |
| Q10 | Voice memos | iPhone transcript → paste | Confirmed as built |
| Q11 | Email routine | Read-only digest now; flag + draft after IT grants access. Asked what IT must grant and what else is needed. | Answered on the Round 2 page: Mail.ReadWrite for flag/draft; Mail.Send only if the brief must arrive by email through the connector. |
| Q12 | Old notes | Import the Brain Dump; skip Log history | Confirmed |
| Q13 | Roster | Seed the project's roster; add others in Settings | Confirmed |
| Q14 | Notifications | **b** — a daily 7 am brief **in the app and by email** | **Built 2026-10-01**: the app builds the brief at 07:00 America/Detroit on weekdays, stores it on the Briefs page and emails it through Resend as soon as `RESEND_API_KEY` is set (SPEC §11). Round 2 R3 confirms the route — the Resend path is built and is the default; R4 picks the days. Settings → *Daily brief* shows the status with *Preview* and *Send now*. |
| Q15 | Names | Keep real names; trim before sharing | Confirmed |

## 2026-10-01 — Template for the team (in progress)

Brandon wants to share the app with the team (Darren first) as a starting point each person customizes with their own Claude Code session. Decision taken: make the app config-driven (`assistant.config.json` holds name, owner, roster, brands, timezone, branding), keep Brandon's instance as the worked example, and distribute as a template (zip now, GitHub template repository once the KSI GitHub organization exists). Open questions are on the Round 2 page.

## 2026-10-01 — Integration pass for Q6 and Q14

Decisions taken while merging the Board swimlanes and the daily brief (details in `docs/SPEC.md` §8, §10, §11):

- **One lane for Brandon in the Person view.** The builder had two ("Brandon Stone (me)" for cards tagged `A:BS`, "Me / unassigned" for blank owners). Merged: SPEC §3 says a blank owner on `A:` means Brandon and his agenda page already lists unowned items, so the Board does the same. Dropping a card into his lane sets `BS` explicitly; cards already there keep their blank owner. The lane comes last. Easy to flip if Brandon prefers two lanes or his lane first.
- **Default grouping stays None** (`DEFAULT_GROUP_BY` in `client/src/lib/boardPrefs.ts`) until R1 is answered.
- **SPEC §0.3 amended** rather than listed as a deviation: the brief is the one email the app sends, to Brandon only, from the app's own sender; the mailbox is never touched.
- **Timezone stays America/Detroit everywhere** (Today buckets, due dates, brief schedule). `assistant.config.json` carries `owner.timezone`, but nothing in the server reads that file yet; wiring the brief alone to it would make the brief disagree with the Today page. To be done together with the template's config loader.
- **Resend is the email path** (R3 option a). Brandon's part: sign up at resend.com with bstone@teamksi.com, create an API key, set `RESEND_API_KEY` in Railway. Nothing else changes.

- 2026-10-01 Round 2 R1 (Brandon): Board opens grouped by person - `DEFAULT_GROUP_BY = "person"` in client/src/lib/boardPrefs.ts; R2 full brief contents; R3 email via Resend; R4 weekdays; R5 IT request drafted (docs/example-instance/it-request.html).
