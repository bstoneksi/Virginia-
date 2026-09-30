# Virginia — Product Spec (v1)

*Synthesized 2026-09-30 from the Ashley/Brandon transcript, the Brain Dump workbook, the claude.ai "Virginia - Executive Assistant" project, and the scope review in `docs/SCOPE.md`. The technical contract that implements this spec is `docs/SPEC.md`. Triage label intended: `ready-for-agent`. Not yet filed: no issue tracker is connected to this session (see Further Notes).*

## Problem Statement

Brandon runs six brands and receives 50–100 emails a day. Commitments, questions, ideas, risks and "raise this next time I see her" notes arrive through email, meetings (Teams and Otter transcripts), voice memos recorded while driving, texts he screenshots, and a paper notebook he carries everywhere. Over the years he has kept them in an Excel brain dump on his PC, a OneNote page per person, a Word doc per direct report, Outlook flags, and a short-lived Claude chat assistant. None of these travel with him, none of them talk to each other, and moving a note from where it was captured to where it is tracked costs more effort than the note is worth — so notes stay in the notebook, priorities live in his head, and when he gets ten unplanned minutes with a direct report he cannot see what he meant to raise. The Claude chat attempt failed for the same reason: its output still had to be pasted back into Excel by hand.

## Solution

Virginia is a single, private tracker that lives on his phone and desktop. Anything he captures — a pasted transcript, a photo of a handwritten page written in his existing tag shorthand, a screenshot of a text, the old Excel brain dump — is turned by Claude into proposed items in his own grammar (Action, Question, Idea, Decision, Watch, New Business; owner initials; brand code; due date; priority). He reviews the proposals in one screen, accepts them, and they become items on a kanban board (Open · In Progress · Parked · Done). From there the same items are visible as **Today** (his own priority list), as an **agenda per direct report** he can copy or print before a conversation, as a **board per brand**, and as a **Personal** list. His claude.ai Virginia project connects to the same tracker through a connector, so talking to Virginia in chat and tapping in the app update one source of truth. The app never touches his mailbox and never sends anything on his behalf; a separate email digest can drop summaries into a **Briefs** page.

## User Stories

**Capture**
1. As Brandon, I want to paste a meeting transcript into the app on my phone, so that the commitments in it become tracked items without me retyping them.
2. As Brandon, I want to paste the transcript that iPhone Voice Memos produced from a memo I recorded in the car, so that a drive-time brain dump ends up in the tracker.
3. As Brandon, I want to photograph a page of my notebook with the camera from inside the app, so that handwritten notes reach the tracker without a copy step.
4. As Brandon, I want the extractor to honor my circled-letter shorthand (A, Q, I, D, W, NB, initials, brand code), so that a tagged line becomes exactly the item I meant.
5. As Brandon, I want untagged lines in a transcript to be read for concrete commitments, requests, decisions and risks and marked as "inferred", so that I still catch things I didn't tag but can see which ones the AI guessed.
6. As Brandon, I want to upload a screenshot of a text message someone sent me, so that a request made over text becomes an item with the sender's ask in the note.
7. As Brandon, I want to give a capture a context label (for example "1:1 with VM 9/30") and a default brand, so that every item extracted from it inherits where it came from.
8. As Brandon, I want the capture to be saved even when the AI step fails, so that I can retry extraction later without re-entering anything.
9. As Brandon, I want explicitly tagged lines to be parsed even when the AI key is missing or the API is down, so that the app degrades to "rules only" instead of failing.
10. As Brandon, I want to see the original text and photos of a capture afterwards, so that I can check what an item was based on.

**Review**
11. As Brandon, I want every proposal shown as an editable card with category, title, note, owner, brand, priority, due date, status and personal flag, so that I can correct the AI before anything lands in the tracker.
12. As Brandon, I want warnings on a proposal (unknown initials, New Business without a target, unparseable date) called out, so that I fix the ambiguous ones first.
13. As Brandon, I want to see the source excerpt each proposal came from, so that I can judge it without re-reading the whole transcript.
14. As Brandon, I want to accept, reject, or accept-all proposals, so that a clean transcript takes two taps and a messy one still gets curated.
15. As Brandon, I want to re-run extraction on a capture after adding context or fixing the roster, so that a bad first pass is not final.
16. As Brandon, I want to discard a capture entirely, so that a mistaken upload leaves no trace on the board.
17. As Brandon, I want the Inbox count of captures awaiting review visible in the navigation, so that nothing sits unreviewed for days.

**Items**
18. As Brandon, I want to type a one-line item on the Today page and have it created for me as an Action, so that a two-second thought is captured without a form.
19. As Brandon, I want every item to carry a category, title, note, brand, owner/target, priority, due date, status, personal flag and optional initiative, so that one item shape serves every view.
20. As Brandon, I want a New Business item to require a person or a brand, so that "raise this with…" always has a "with whom".
21. As Brandon, I want an Action with no owner to mean "me", so that my own to-dos need no extra tap.
22. As Brandon, I want to change status with one tap from any card, so that clearing an item is as fast as flagging an email.
23. As Brandon, I want Done items kept and searchable forever rather than deleted, so that the history of what was decided and addressed is the record.
24. As Brandon, I want to add a comment to an item and see its history (created, status changes, edits), so that I remember why a thing moved.
25. As Brandon, I want to delete an item only after a confirmation, so that a mis-tap never loses work.
26. As Brandon, I want overdue due dates shown in red everywhere, so that slipping items stand out.

**Board**
27. As Brandon, I want a kanban with the columns Open, In Progress, Parked and Done, so that the parking lot is a column I can drag into and out of rather than a separate list.
28. As Brandon, I want to drag a card between columns and up and down inside a column, so that re-prioritizing is physical and immediate.
29. As Brandon, I want my manual order to persist and survive a reload, so that the board looks the way I left it.
30. As Brandon, I want to filter the board by brand, person, category, personal-only and text, so that I can look at "everything Henderson Glass" in one tap.
31. As Brandon, I want the Done column collapsed to the last 30 days with a "show all", so that the board stays about live work.
32. As Brandon, I want cards to show the category badge, owner initials, brand chip in its brand color, due date and priority dot, so that I can read a column at a glance.

**Today**
33. As Brandon, I want the app to open on a Today page listing my overdue items, items due this week, my High-priority items and unowned items, so that the first screen on my phone is my priority list.
34. As Brandon, I want unowned, un-branded items surfaced for triage, so that quick captures don't hide in the backlog.
35. As Brandon, I want the desktop to open on the Board instead, so that the big screen shows the big picture.

**People and brands**
36. As Brandon, I want a list of my direct reports with open-item counts, so that I can see who I owe the most conversation.
37. As Brandon, I want an agenda page per person grouped New Business → Actions → Questions → Watch → Ideas → Decisions, active items first and parked items at the bottom, so that I can run a 1:1 straight off the phone.
38. As Brandon, I want to copy a person's agenda as Markdown or print it, so that I can hand it over or paste it into Teams before a meeting.
39. As Brandon, I want to add an item from a person's agenda with that person pre-filled, so that "oh, one more thing for Steve" is one tap.
40. As Brandon, I want a page per brand with a filtered board and an agenda tab, so that a brand review has its own view.
41. As Brandon, I want brand sub-units (K&B Sales / Install / Ops) shown under KSI Kitchen & Bath, so that division detail is available without cluttering the brand list.

**Personal, search, briefs**
42. As Brandon, I want personal to-dos (PTD) kept out of brand views but visible on their own page, so that "renew passport" never appears on a company agenda.
43. As Brandon, I want one search box over items and captures, so that I can find "Atlas renewal" wherever it was mentioned.
44. As Brandon, I want a Briefs page that shows summaries pushed in by the email routine, so that I read what I was informed about without opening the emails.

**Settings and import**
45. As Brandon, I want to add, edit and archive people and brands and mark which person is me, so that the roster in the app matches reality without a developer.
46. As Brandon, I want to manage initiatives (Active / On Hold / Complete) and tag items with them, so that cross-brand efforts roll up.
47. As Brandon, I want to drop my Brain Dump workbook on an Import screen and see a preview that maps New Business → NB, Action Items → A, Watch List → W and Parking Lot → Parked, so that years of notes come across in one go.
48. As Brandon, I want to fix an unmatched brand or person and untick rows in the preview before committing, so that a bad mapping never reaches the board.
49. As Brandon, I want imported items to remember they came from the import, so that I can trace a row back later.
50. As Brandon, I want the Settings page to show me the connector address pattern and whether AI is configured, so that I can finish setup without reading logs.

**Claude connector**
51. As Virginia (the claude.ai project), I want to list, add, update and search items, pull a person's or brand's agenda, and read Today, so that chatting with Virginia updates the same tracker the app shows.
52. As Virginia, I want to add a Brief, so that the scheduled email digest can deliver into the app.
53. As Brandon, I want the connector protected by a long secret in its URL that I can rotate, so that only my Claude project can reach my data.

**Access and operations**
54. As Brandon, I want to log in once with a passphrase and stay signed in on each device for about 90 days, so that opening the app on my phone is instant.
55. As Brandon, I want every API route and the connector to refuse unauthenticated calls, so that a leaked link exposes nothing.
56. As Brandon, I want the app deployable as one Railway service with one persistent volume, so that hosting costs a few dollars and there is one file to back up.
57. As Brandon, I want to install the app on my iPhone home screen and use it at 375 px wide with a thumb-reachable bottom bar, so that it feels like an app, not a website.
58. As Brandon, I want a setup wizard for the accounts only I can create (GitHub, Railway, Anthropic key), so that I am not blocked on a developer for account chores.
59. As Brandon, I want the app to run locally with a single command and no accounts for a first look, so that I can evaluate it before deploying.

## Implementation Decisions

- **One service, one database.** A Node 24 server (Hono) serves both the JSON API and the built React client. Storage is a single SQLite file on a persistent volume using Node's built-in SQLite module — no native builds, no separate database service. A Postgres migration is deliberately deferred until the app has more than one user.
- **Domain model.** *Item* (category A/Q/I/D/W/NB; title; note; brand code; owner/target initials; initiative; priority Low/Medium/High; status Open/In Progress/Parked/Done; due date as a plain calendar date; manual rank; personal flag; context; source capture). *Capture* (kind text/transcript/image/screenshot/mixed/import; raw text; files stored as blobs; status pending/reviewed/discarded; extractor notes/error). *Proposal* (a draft Item plus confidence, inferred flag, source excerpt, warnings; state proposed/accepted/rejected; links to the Item it became). *Person* (initials unique; one row flagged as "me"), *Division* (code, name, kind brand/function/personal, parent code, brand colors), *Initiative* (Active/On Hold/Complete), *Brief* (kind, title, Markdown body), *Item event* (created/status/edit/comment) and *Session*.
- **Category vs. status are orthogonal.** Category says what a thing is; status says where it is. The Brain Dump's "Parking Lot" becomes status Parked, not a category; Decisions default to Done.
- **Ordering rule.** New items enter their status column at the top (rank below the current minimum). A single "reorder" call receives the full ordered id list of a column and both moves cards into that column and rewrites ranks, so drag-between-columns is one round trip.
- **Lifecycle rules.** Moving to Done stamps a completion time; leaving Done clears it. Every create, status change, edit and comment writes an event. The app never deletes Done items on its own; hard delete is an explicit confirmed action.
- **Agenda and Today are pure functions** shared by server and client: grouping in the fixed category order, active before parked, priority then due date then rank; Today buckets (overdue, due within 7 days, High priority, unowned) are disjoint and use the "me" person, with unowned Actions counting as mine.
- **Extraction contract.** Input: optional text, up to eight images, context, default brand, today's date in America/Detroit. Output: proposals plus notes. Explicitly tagged lines are authoritative and are also parsed deterministically by a rule parser; the rule parser is the fallback when the API key is absent and a cross-check when it is present (anything the model dropped is appended with a warning). Untagged material yields inferred proposals at reduced confidence; owners are never invented — people not on the roster go into the note with a warning. New Business without a target is kept with a warning, not dropped. The model is Claude Opus 5.5 by default (configurable), called with structured output constrained to the proposal schema, medium effort, no forced tool choice; a refusal returns zero proposals with a note. Roster and brand codes travel in the user message so the system prompt stays cacheable.
- **Review is the gate.** Nothing the extractor proposes becomes an Item until accepted; the only bypass is the connector's add-items tool, because there Brandon is acting deliberately in chat.
- **API shape.** JSON under one prefix; lists return arrays; validation errors 422, unknown ids 404, auth failures 401. Endpoints for auth, bootstrap (reference data + capability flags), items (list with filters, create, read with history, patch, delete, reorder, comments), agenda by person and by brand, today, search, people/divisions/initiatives (archive instead of delete), captures (multipart create that runs extraction, list, read, file download, re-extract, per-proposal edit/accept/reject, accept-all, discard), import (preview then commit) and briefs.
- **Authentication.** Single passphrase compared in constant time; an HMAC-signed session cookie (HttpOnly, SameSite=Lax, Secure outside localhost, 90 days) backed by a sessions table so logout truly invalidates; a bearer token equal to the connector secret is accepted as an alternative for automation. A local-development switch disables auth and shouts about it at boot.
- **Connector.** A Model Context Protocol endpoint over Streamable HTTP mounted at a path that includes the secret token (constant-time compared), stateless per request, exposing list/add/update items, agenda, today, search, reference data and add-brief. Rotating the token is a config change.
- **Import.** The workbook (xlsx or macro-enabled xlsm, same container) is scanned for header rows matching Date · Note · Division · Owner/Target · Priority · Due Date · Status; the table name is the label above the header. Brands and people are fuzzy-matched by code and name; Excel dates and mm/dd/yyyy strings normalize to calendar dates; unmatched values become warnings in a preview the user can correct before committing; the commit records one import capture as provenance.
- **Client.** React single-page app with a bottom navigation on phones (Today, Board, People, Capture, More) and a sidebar on desktop; kanban drag-and-drop with optimistic updates; category, status and priority colors and brand colors follow the conventions already set in the Virginia project; installable via web-app manifest and iOS meta tags, no service worker in v1.
- **Configuration and hosting.** Port, data directory, passphrase, session secret, API key, model, connector token and the dev-auth switch come from environment variables; a Dockerfile plus Railway config deploy the single service with a health endpoint; data lives on a volume mounted at the data directory.
- **Seed data.** First boot seeds the brands and functions (K&B and its three sub-units, APP, HG, PF, RF, TS, FOB, ACC, S&M, Personal), the twelve-person roster with Brandon flagged as "me", and one initiative named BAU. Everything is editable afterwards.

## Testing Decisions

- **What makes a good test here:** it exercises the app through its outermost seam — an HTTP request into the assembled application with an in-memory database and a fake extractor injected — and asserts on responses and on subsequent reads, never on table contents or internal function calls. Date-sensitive logic is tested with a fixed "today" passed in, never the wall clock. No test opens a network port or calls the real Claude API.
- **Primary seam (proposed — confirm):** the application factory with injected dependencies (database handle, extractor function, importer function, connector handler) driven by in-process requests. This one seam covers items, reorder, agenda, today, captures and review, import preview/commit, briefs, auth and the connector, because all of them are mounted on the same app.
- **Secondary seams, kept deliberately few:** the pure agenda/today functions (ordering and bucketing rules are easiest to pin down with plain inputs), the deterministic tag-grammar parser (each tag, initials, brand override, personal flag, relative due phrases against a fixed date, urgency and parking-lot words, New Business without a target), the import parser fed a workbook generated inside the test, and the extractor's merge logic with a fake model client (unknown-code scrubbing, refusal handling, retry on unparsable output, rule-parser fallback).
- **Modules under test:** API routes and repository behaviour (via the primary seam), agenda/today functions, grammar parser, import parser and mapping, extractor merge logic, auth middleware (401 without cookie, cookie set on login, bearer accepted, tampered signature rejected, dev switch bypass), connector (initialize, tools/list, a tools/call round trip, wrong token rejected).
- **Prior art:** the repository is new, so the pattern being established in this build is the prior art: node:test files beside the code, building the app against an in-memory database and calling it in-process. Browser-level checks (375 px layout, drag persistence, capture-to-agenda flow) are done manually or by a reviewing agent in a real browser, not automated in v1.

## Out of Scope

- Shared or editable pages for direct reports (needs per-user login); Microsoft sign-in.
- Audio upload and transcription inside the app (Claude does not accept audio; iOS Voice Memos transcripts are the v1 path).
- Anything that touches the mailbox: flagging, drafting, sending, moving. The email digest is a separate routine that only reads mail and may push a Brief in.
- OneNote or Otter integrations, push notifications, a daily brief, offline mode / service worker.
- Multi-user, Postgres, backups automation beyond the volume, importing the master tracker's Log-tab history.
- Employee-name scrubbing (only made sense for the shared tracker).

## Further Notes

- The fifteen design questions and the answers v1 assumed are in `docs/SCOPE.md` §3; the build contract (schema, endpoint signatures, extraction prompt rules, MCP tool list, page list) is `docs/SPEC.md`; deployment and the connector setup are in `docs/DEPLOY.md`; the accounts only Brandon can create are walked through by `docs/SETUP-WIZARD.sh`; the email routine's policy and ready-to-schedule prompt are in `docs/EMAIL-ROUTINE.md`.
- Two roster facts differ from the Virginia project: the flooring brand's email domain is riemerfloors.com (the project spells it "Reimer"), and Cabinets Express / Brooke Dando appear in mail but not in the roster — both editable in Settings.
- Publishing: this session has no issue tracker or triage-label vocabulary configured, and the repository has no GitHub remote yet. Run `/setup-matt-pocock-skills` (and the setup wizard's GitHub stage) and this document can be filed as the issue with the `ready-for-agent` label as-is.
