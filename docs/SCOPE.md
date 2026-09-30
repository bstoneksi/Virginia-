# Virginia — Scope, Findings & Open Questions

*Prepared 2026-09-30 for Brandon Stone (CEO, KSI Family of Brands). Sources: the Ashley/Brandon transcript, the "Brandon Runnign Brain Dump.xlsm" workbook, the "Virginia - Executive Assistant" project on claude.ai (instructions + memory), and the "Claude Framework for Claude Code Assistant Buildout" doc.*

---

## 1. What I reviewed and what it told me

**The transcript (Sep 30).** Your inbox philosophy: read as it arrives if you have capacity, clear it if it takes under two minutes, otherwise **flag** it; flagged = to-do, complete then delete, no folders. 50–100 emails a day. AI may **draft, never send**. You want a periodic "here's what you were informed about" summary. You keep a running to-do list in Excel plus a notebook, and you've tried OneNote pages per person, a Word doc per direct report, and a Claude agent ("Virginia") that didn't stick. What you want: one consolidated place, fed from voice memos, meeting transcripts (Otter for client-facing, Teams for internal), photos of handwritten notes (with your circled-letter legend), and screenshots of texts, sortable by **person** or **brand/division**, with a **priority list** for you, **kanban re-prioritizing**, **due dates**, and eventually pages you can **share with direct reports**.

**The Brain Dump workbook** (OneDrive › Desktop › Brandon Clerical › Brandon Runnign Brain Dump.xlsm). Four structurally identical tables side by side: **New Business, Action Items, Parking Lot, Watch List**, each with `Date | Note | Division | Owner/Target | Priority | Due Date | Status`. Status is Not Started / In Progress / Complete; Priority is Low / Medium / High; a 14-entry Division dropdown; a VBA auto-sort macro. The Microsoft 365 connector refuses `.xlsm` files and opening it in your browser stopped at a Microsoft password prompt (I don't enter passwords), so I could not read the rows themselves. The app therefore has an Excel **Import** screen that reads the workbook directly — drop the file in once and the rows come across.

**The Virginia project on claude.ai** already contains the rulebook, and it's good. I'm adopting it wholesale:

| Rule | Value |
|---|---|
| Category tags | `A:` action · `Q:` question · `I:` idea · `D:` decision · `W:` watch · `NB:` new business (target required) |
| Owner/Target | initials of a direct report; blank on `A:` = you |
| Roster | PH Patrick Hatch · DK David Karras · AG Amanda Gentner · DJ Darren Johnston · MN Matthew Norton · SB Steve Bevel · VM Vincent Moynihan · JM Joshua Miller · MR Mark Renn · AN Amanda Norton · JR Jennifer Rankin · BS you |
| Division codes | `K&B` (+ `K&B-S`, `K&B-I`, `K&B-O`) · `RF` Riemer Floors · `APP` KSI Appliances · `HG` Henderson Glass · `PF` Paramount Fence · `TS` TrueScale Studio · `FOB` corporate · `ACC` · `S&M` · `PTD` personal |
| Lifecycle | Open → Parked → Addressed; never delete, parked items stay visible at the bottom of agendas |
| Initiatives | optional roll-up with its own Active / On Hold / Complete lifecycle; default `BAU` |
| Colors | HG red · RF near-black · APP purple · K&B navy · PF forest green · TS orange · FOB charcoal; Watch red · Decision green · Action grey/red · NB blue · Question gold · Idea teal; Open red · Parked beige-orange · Done green |
| Scrapped | the `private` flag |

Two small corrections from your mailbox: the flooring brand's email domain is **riemerfloors.com** (the project spells it "Reimer"), and **Cabinets Express** (Matt Norton) and **Brooke Dando (EDM)** appear in your mail but not in the project's roster/brand list. The app seeds the project's list and lets you edit it in Settings.

**Environment facts that shape the plan.**
- The Microsoft 365 connector wired into Claude here is **read-only** for mail (Mail.Read). It has **no** Mail.ReadWrite, Mail.Send, People.Read or Team.ReadBasic. So today Claude can *read* your inbox and *summarize*, but cannot **flag**, **create drafts**, or **send**. Those three need an IT admin (Doug/Rob per your project notes) to grant consent. Teams meeting transcripts *are* readable (OnlineMeetingTranscript.Read.All).
- Claude's API does not accept audio, so voice memos need a transcript first (iPhone Voice Memos produces one on iOS 18+).
- This machine has Node 24 and git, but no GitHub CLI, Railway CLI, Docker or Python. You have no GitHub repo or Railway account yet — those two, plus an Anthropic API key, are the only things only you can create. `docs/SETUP-WIZARD.sh` walks you through them.

---

## 2. The shape of the system

```
 CAPTURE (phone or desktop)                 VIRGINIA APP (Railway, PWA)                    OUTPUT
 ─────────────────────────                  ───────────────────────────                    ──────
 Voice memo → iOS transcript → paste ─┐     Inbox: raw capture stored                      Today  (your priority list)
 Teams / Otter transcript → paste ────┼──►  Claude extracts tagged rows ──► Review ──►      Board  (kanban by status)
 Photo of handwritten page ───────────┤     (grammar above, roster, divisions)   accept     People (agenda per direct report)
 Screenshot of a text/email ──────────┤                                                    Brands (board per division)
 Brain Dump .xlsm → Import screen ────┘                                                    Personal · Search · Initiatives
                                                                                            ↓
 Claude "Virginia" project ◄──── MCP connector (same tracker, read/write) ────►             Copy/print agenda → share (v2: live pages)

 EMAIL (separate routine, later): read-only 2-hour digest now; flag + draft after IT grants Mail.ReadWrite; never send.
```

---

## 3. Round 1 — decisions that are yours (with my recommendation)

I could not wait for answers, so **v1 is being built on the ➡️ recommendations below**. Anything you change when you're back gets applied; nothing here is expensive to reverse.

❓ **Q1 - Hosting & accounts**: Railway + GitHub as discussed? Options: (a) Railway single service with a persistent volume (SQLite file, one thing to back up), (b) Railway service + managed Postgres, (c) somewhere else (Azure, since you're an M365 shop).

➡️ (a). Single-user app, one service, one volume. Create the GitHub and Railway accounts under bstone@teamksi.com; Railway's Hobby plan covers this. Move to Postgres only if the app becomes multi-user.

---

❓ **Q2 - Login**: (a) one strong passphrase, devices stay signed in ~90 days; (b) Microsoft sign-in (needs an Entra app registration — IT again); (c) both later.

➡️ (a) now, (b) when direct reports get their own pages.

---

❓ **Q3 - How captures get in**: (a) inside the app — paste text / upload photos, the app calls Claude and shows proposed rows to accept; (b) only through the Virginia project in Claude chat, which writes into the app via a connector; (c) both.

➡️ (c), with (a) primary because it works from the phone in two taps. The MCP connector means the Virginia project can *also* read and write the same tracker, so your existing habit keeps working.

---

❓ **Q4 - Status model**: the project uses Open → Parked → Addressed; the Brain Dump uses Not Started / In Progress / Complete. Pick one: (a) Open · Parked · Done (3), (b) Open · In Progress · Parked · Done (4), (c) keep both vocabularies.

➡️ (b). Kanban columns = these four. "Parking Lot" stops being a separate list and becomes the **Parked** status, so a card can move in and out of the lot by dragging. Done items are kept forever and searchable, never deleted.

---

❓ **Q5 - Categories vs. the four Brain Dump lists**: keep the six tags (A/Q/I/D/W/NB)? Mapping on import: New Business → NB, Action Items → A, Watch List → W, Parking Lot → (category from the text, status Parked).

➡️ Yes. Category = *what kind of thing it is*; status = *where it is in its life*. Keeping them separate is what makes "New Business for Vince" and "Parked items across HG" both one click.

---

❓ **Q6 - Kanban semantics**: (a) columns by status, drag to change status, drag within a column to set your manual order, priority as a badge; (b) columns by priority; (c) swimlanes per person/division.

➡️ (a), with filters for division / person / category / personal on top. (c) is a filter away, not a layout.

---

❓ **Q7 - Your own list ("Brandon's priority list")**: what should the landing page show? Proposal: **Today** = overdue + due this week + High-priority open items you own + anything with no owner, then the Inbox count of captures awaiting review.

➡️ Yes; on the phone the app opens on Today, desktop opens on the Board.

---

❓ **Q8 - Sharing with direct reports**: (a) v1 = "Copy agenda" (Markdown) + printable page per person; (b) v1 = read-only share link per person; (c) v1 = they can log in and add New Business / mark items addressed.

➡️ (a) now — it replaces the Word-doc-per-person ritual immediately. (c) is v2 once Q2(b) exists; the data model already supports it.

---

❓ **Q9 - Handwriting legend**: use the project grammar as-is (a circled **A** = `A:`, circled **Q** = `Q:`, initials after the letter = owner/target, division code anywhere on the line). Untagged lines: (a) ignore, (b) Claude infers a category and marks it "inferred" so you eyeball it in review.

➡️ (b). Nothing lands in the tracker without passing the review screen, so an inference costs you one glance, and a miss costs nothing.

---

❓ **Q10 - Voice memos**: (a) record in iPhone Voice Memos, tap Transcript, copy, paste into Capture; (b) upload the audio and let the app transcribe (needs a third-party speech service such as Deepgram or Whisper — Claude does not take audio); (c) keep using the "Virginia" trigger word in Claude chat.

➡️ (a) for v1 and (c) stays valid via the connector. Add (b) if the copy-paste step turns out to be the friction that kills the habit.

---

❓ **Q11 - The email routine**: what should run every ~2 hours during business hours? Possible today (read-only): a **digest** of emails you were CC'd/FYI'd on and threads with no reply from you, grouped by sender/brand, no need to open them. Needs IT consent (Mail.ReadWrite): **flagging** emails that read as to-dos and **drafting** replies into your Drafts folder. Draft-eligible categories I'd propose: thank-you/acknowledgment, scheduling confirmations, "received, will review by X", forwarding-with-a-line to a direct report. Everything else: summarize + suggest a one-line stance, you write it. Never send.

➡️ Start the digest now (delivered into the app's **Briefs** tab via the connector, and visible in Claude), 7 am–6 pm ET weekdays. Ask Doug/Rob for Mail.ReadWrite; then turn on flag + draft with the categories above. Confirm the hours and the draft categories.

---

❓ **Q12 - Migration**: import the Brain Dump now? Also the Log tab of the master tracker (history)?

➡️ Import the Brain Dump (all four tables) through the Import screen — it previews the mapping and lets you fix a row before committing. Skip the Log history unless you search it often.

---

❓ **Q13 - Roster & brands seed**: seed exactly the project's 11 direct reports and division codes, plus **Personal**; add Cabinets Express and Brooke Dando?

➡️ Seed the project list; you add the rest in Settings in thirty seconds. Tell me if any direct report has changed.

---

❓ **Q14 - Notifications**: none in v1 (Today view is the pull), daily 7 am brief later? Where would you want it — in the app, email, Teams?

➡️ None in v1. Decide after two weeks of use.

---

❓ **Q15 - Privacy**: the tracker memory says employee names get scrubbed from entries. This app is yours alone behind a password — keep real names and details in it?

➡️ Yes, keep names. Scrubbing only made sense for the shared tracker; the "Copy agenda" export is where you'd trim before sharing.

---

## 4. What v1 is being built as (until you say otherwise)

- **Stack**: Node 24 + Hono API, SQLite via Node's built-in `node:sqlite` (no native builds), React 19 + Vite + Tailwind PWA, `@dnd-kit` kanban, Anthropic SDK (`claude-opus-5-5`, structured outputs), MCP Streamable-HTTP endpoint, ExcelJS import. Dockerfile + `railway.json` included.
- **Pages**: Login · Today · Board · People (+ agenda) · Brands (+ board) · Personal · Capture/Inbox (+ review) · Search · Briefs · Settings (roster, divisions, initiatives, import, connector URL).
- **Grammar, roster, codes, colors**: from the Virginia project, seeded on first run.
- **Rules**: never delete Done; every AI proposal passes review; drafts/sending email are out of the app entirely.
- **Deferred**: shared pages for direct reports, audio transcription, Microsoft sign-in, email flag/draft automation, OneNote sync.

## 5. Things only you can do

1. Create a GitHub account/repo and push the code (`docs/SETUP-WIZARD.sh` does the git parts once you have the account).
2. Create a Railway account, connect the repo, add a volume at `/data`, set the environment variables.
3. Create an Anthropic API key at console.anthropic.com and set a monthly spend limit.
4. Ask IT for Mail.ReadWrite on the Claude Microsoft 365 connector (for flagging/drafting, later).
