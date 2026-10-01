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
| Q6 | Board layout | Accepted columns-by-status **and** wants the person/brand view ("c") as the primary way he looks at work outside his own items. Asked whether a filter gives the person/brand layout. | **Change**: add a "group by person / brand" (swimlane) mode on the Board; People and Brands pages already give per-person and per-brand views. Round 2 asks which grouping should be the default. |
| Q7 | Landing page | Today on phone, Board on desktop | Confirmed as built |
| Q8 | Sharing | Copy/print agenda now; live pages later | Confirmed as built |
| Q9 | Untagged lines | Inferred, marked for review | Confirmed as built |
| Q10 | Voice memos | iPhone transcript → paste | Confirmed as built |
| Q11 | Email routine | Read-only digest now; flag + draft after IT grants access. Asked what IT must grant and what else is needed. | Answered on the Round 2 page: Mail.ReadWrite for flag/draft; Mail.Send only if the brief must arrive by email through the connector. |
| Q12 | Old notes | Import the Brain Dump; skip Log history | Confirmed |
| Q13 | Roster | Seed the project's roster; add others in Settings | Confirmed |
| Q14 | Notifications | **b** — a daily 7 am brief **in the app and by email** | **Change**: build the daily brief; email delivery needs a sending path (Round 2 decides which). |
| Q15 | Names | Keep real names; trim before sharing | Confirmed |

## 2026-10-01 — Template for the team (in progress)

Brandon wants to share the app with the team (Darren first) as a starting point each person customizes with their own Claude Code session. Decision taken: make the app config-driven (`assistant.config.json` holds name, owner, roster, brands, timezone, branding), keep Brandon's instance as the worked example, and distribute as a template (zip now, GitHub template repository once the KSI GitHub organization exists). Open questions are on the Round 2 page.
