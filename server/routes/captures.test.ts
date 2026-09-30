import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyDraft } from "../../shared/types";
import type { ApiError, Capture, CaptureSummary, ImportCommitResult, ImportPreview, Item, Proposal } from "../../shared/types";
import type { ExtractProposalsFn, ParseImportFileFn } from "../contracts";
import { AI_NOT_CONFIGURED_NOTE } from "../ai/extract";
import type { ItemDetail } from "../db/repo";
import { call, json, makeTestApp } from "../lib/testing";
import { MAX_FILE_BYTES, dropResolvedDuplicates, inferCaptureKind, looksLikeTranscript, sniffImageMime } from "./captures";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]);
const HEIC = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");

function form(fields: Record<string, string>, files: { field?: string; name: string; type: string; bytes?: Uint8Array }[] = []): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append(f.field ?? "files[]", new File([f.bytes ?? PNG], f.name, { type: f.type }));
  return fd;
}

async function postCapture(t: ReturnType<typeof makeTestApp>, body: FormData | Record<string, unknown>): Promise<Capture> {
  const res = await call(t, "POST", "/api/captures", body);
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return json<Capture>(res);
}

describe("capture kind inference", () => {
  it("classifies text, transcript, image, screenshot and mixed", () => {
    assert.equal(inferCaptureKind("A: VM call", []), "text");
    assert.equal(inferCaptureKind("x".repeat(1501), []), "transcript");
    assert.equal(inferCaptureKind("Brandon: hi\nVince: hello\nBrandon: the install\nVince: yes\nBrandon: ok", []), "transcript");
    assert.equal(inferCaptureKind("A: one\nQ: two\nI: three\nW: four\nNB: five", []), "text", "tags are not speakers");
    assert.equal(inferCaptureKind(null, [{ filename: "photo.HEIC", mime: "image/heic" }]), "image");
    assert.equal(inferCaptureKind(null, [{ filename: "IMG_0421.PNG", mime: "image/png" }]), "screenshot");
    assert.equal(inferCaptureKind(null, [{ filename: "Screen Shot 2026-09-30.png", mime: "image/png" }]), "screenshot");
    assert.equal(inferCaptureKind("notes", [{ filename: "a.jpg", mime: "image/jpeg" }]), "mixed");
    assert.equal(looksLikeTranscript("short"), false);

    // Forty tagged lines are plain notes however long they run, not a transcript.
    const tagged = Array.from({ length: 40 }, (_, i) => `A: VM do thing number ${i + 1} for the Henderson Glass showroom`).join("\n");
    assert.ok(tagged.length > 1500);
    assert.equal(inferCaptureKind(tagged, []), "text", "long tagged notes are still text");
    const withNotes = Array.from({ length: 30 }, (_, i) => `A: VM thing ${i + 1} for the showroom, long enough\n  said during the walk-through\n  follow up next week`).join("\n");
    assert.ok(withNotes.length > 1500);
    assert.equal(inferCaptureKind(withNotes, []), "text", "indented notes under a tag count with it");
    assert.equal(inferCaptureKind(`A: one thing\n${"Brandon: hi there\nVince: hello again\nBrandon: the install\nVince: yes sir\nBrandon: ok then\n".repeat(30)}`, []), "transcript");
  });

  it("types uploads by their bytes", () => {
    assert.equal(sniffImageMime(PNG), "image/png");
    assert.equal(sniffImageMime(JPEG), "image/jpeg");
    assert.equal(sniffImageMime(HEIC), "image/heic");
    assert.equal(sniffImageMime(new TextEncoder().encode("GIF89a\0\0\0\0\0\0\0\0")), "image/gif");
    assert.equal(sniffImageMime(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
    assert.equal(sniffImageMime(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31])), "image/heif");
    assert.equal(sniffImageMime(HTML), null);
    assert.equal(sniffImageMime(new Uint8Array([0xff, 0xd8])), null, "too short to tell");
  });
});

describe("dropResolvedDuplicates", () => {
  const resolved = (title: string, excerpt: string | null, state: "accepted" | "rejected" = "accepted"): Proposal => ({
    id: title,
    captureId: "c",
    state,
    itemId: null,
    draft: emptyDraft({ title }),
    confidence: 0.9,
    inferred: false,
    sourceExcerpt: excerpt,
    warnings: [],
    sortOrder: 0,
  });
  const draft = (title: string, excerpt: string | null) => ({ draft: emptyDraft({ title }), confidence: 0.6, inferred: true, sourceExcerpt: excerpt, warnings: [] });

  it("skips drafts that restate an accepted or rejected line and keeps new ones", () => {
    const kept = dropResolvedDuplicates(
      [resolved("Call the installer", "A: VM Call the installer due 10/03"), resolved("Go with vendor B", "D: Go with vendor B", "rejected")],
      [
        draft("Call installer", "A: VM call the installer due 10/03"),
        draft("Decide on vendor B", "D: Go with vendor B"),
        draft("Order the glass samples", "Vince asked for glass samples by Friday"),
      ],
    );
    assert.equal(kept.skipped, 2);
    assert.deepEqual(kept.kept.map((p) => p.draft.title), ["Order the glass samples"]);
    assert.deepEqual(dropResolvedDuplicates([], [draft("x", "y")]).skipped, 0);
  });
});

describe("POST /api/captures (rule parser only — no extractor injected)", () => {
  it("stores the capture, parses tagged lines and returns proposals", async () => {
    const t = makeTestApp();
    const capture = await postCapture(
      t,
      form({
        text: "A: VM Call the installer due 10/03\nJust a note line without a tag\nD: Go with vendor B\nNB: Expand into Toledo",
        context: "1:1 with VM",
        defaultDivisionCode: "hg",
        title: "Tuesday notes",
      }),
    );
    assert.equal(capture.kind, "text");
    assert.equal(capture.status, "pending");
    assert.equal(capture.error, null);
    assert.equal(capture.title, "Tuesday notes");
    assert.equal(capture.context, "1:1 with VM");
    assert.equal(capture.defaultDivisionCode, "HG");
    assert.equal(capture.rawText?.startsWith("A: VM Call"), true);
    assert.equal(capture.proposalCount, 3);
    assert.equal(capture.proposedCount, 3);
    assert.equal(capture.fileCount, 0);
    assert.ok(capture.notes.includes(AI_NOT_CONFIGURED_NOTE));
    assert.ok(capture.notes.includes("Model: rule-parser"));

    const [a, dDecision, nb] = capture.proposals;
    assert.ok(a && dDecision && nb);
    assert.equal(a.state, "proposed");
    assert.equal(a.inferred, false);
    assert.equal(a.sourceExcerpt, "A: VM Call the installer due 10/03");
    assert.deepEqual(
      { ...a.draft },
      {
        ...emptyDraft(),
        category: "A",
        title: "Call the installer",
        ownerInitials: "VM",
        divisionCode: "HG",
        dueDate: "2026-10-03",
      },
    );
    assert.equal(dDecision.draft.category, "D");
    assert.equal(dDecision.draft.status, "Done");
    assert.equal(nb.draft.category, "NB");
    assert.equal(nb.draft.divisionCode, "HG", "default division satisfies the NB target");
    assert.deepEqual(nb.warnings, []);

    const listed = await json<CaptureSummary[]>(await call(t, "GET", "/api/captures?status=pending"));
    assert.deepEqual(listed.map((c) => c.id), [capture.id]);
    assert.equal((await json<CaptureSummary[]>(await call(t, "GET", "/api/captures?status=reviewed"))).length, 0);
    assert.equal((await call(t, "GET", "/api/captures?status=bogus")).status, 422);
    assert.equal((await json<Capture>(await call(t, "GET", `/api/captures/${capture.id}`))).id, capture.id);
    assert.equal((await call(t, "GET", "/api/captures/nope")).status, 404);
  });

  it("accept (with overrides) / reject / accept-all / discard", async () => {
    const t = makeTestApp();
    const capture = await postCapture(t, form({ text: "A: VM one\nQ: DK two\nI: three\nW: four", context: "Staff meeting" }));
    const [p1, p2, p3, p4] = capture.proposals;
    assert.ok(p1 && p2 && p3 && p4);

    const accepted = await call(t, "POST", `/api/captures/${capture.id}/proposals/${p1.id}/accept`, { priority: "High", title: "One (edited)" });
    assert.equal(accepted.status, 200);
    const { proposal, item } = await json<{ proposal: Proposal; item: Item }>(accepted);
    assert.equal(proposal.state, "accepted");
    assert.equal(proposal.itemId, item.id);
    assert.equal(item.title, "One (edited)");
    assert.equal(item.priority, "High");
    assert.equal(item.ownerInitials, "VM");
    assert.equal(item.sourceCaptureId, capture.id);
    assert.equal(item.context, "Staff meeting");
    const detail = await json<ItemDetail>(await call(t, "GET", `/api/items/${item.id}`));
    assert.equal(detail.capture?.id, capture.id);
    assert.equal((await call(t, "POST", `/api/captures/${capture.id}/proposals/${p1.id}/accept`)).status, 409);

    const rejected = await json<Proposal>(await call(t, "POST", `/api/captures/${capture.id}/proposals/${p2.id}/reject`));
    assert.equal(rejected.state, "rejected");

    const edited = await json<Proposal>(await call(t, "PATCH", `/api/captures/${capture.id}/proposals/${p3.id}`, { draft: { title: "Three (renamed)", divisionCode: "PF" } }));
    assert.equal(edited.draft.title, "Three (renamed)");
    assert.equal(edited.draft.divisionCode, "PF");
    assert.equal((await call(t, "PATCH", `/api/captures/${capture.id}/proposals/${p3.id}`, { title: "no draft wrapper" })).status, 422);

    const all = await call(t, "POST", `/api/captures/${capture.id}/accept-all`, undefined);
    assert.equal(all.status, 200);
    const { items } = await json<{ items: Item[] }>(all);
    // The rule parser capitalises the first word of a title ("W: four" → "Four").
    assert.deepEqual(items.map((i) => i.title).sort(), ["Four", "Three (renamed)"]);
    const closed = await json<Capture>(await call(t, "GET", `/api/captures/${capture.id}`));
    assert.equal(closed.status, "reviewed");
    assert.ok(closed.reviewedAt);
    assert.equal(closed.proposedCount, 0);
    assert.equal((await json<Item[]>(await call(t, "GET", "/api/items"))).length, 3);

    const other = await postCapture(t, form({ text: "A: throwaway" }));
    const [throwaway] = other.proposals;
    assert.ok(throwaway);
    assert.equal((await call(t, "POST", `/api/captures/${other.id}/discard`)).status, 204);
    assert.equal((await json<Capture>(await call(t, "GET", `/api/captures/${other.id}`))).status, "discarded");
    assert.equal((await call(t, "POST", "/api/captures/nope/discard")).status, 404);
    assert.equal((await call(t, "POST", `/api/captures/${capture.id}/proposals/nope/accept`)).status, 404);

    // A discarded capture is closed: a stale Review tab cannot create items from it any more.
    for (const [method, url] of [
      ["POST", `/api/captures/${other.id}/proposals/${throwaway.id}/accept`],
      ["POST", `/api/captures/${other.id}/proposals/${throwaway.id}/reject`],
      ["POST", `/api/captures/${other.id}/accept-all`],
    ] as const) {
      const res = await call(t, method, url);
      assert.equal(res.status, 409, `${method} ${url}`);
      assert.deepEqual(await res.json(), { error: "Capture was discarded" });
    }
    assert.equal((await call(t, "PATCH", `/api/captures/${other.id}/proposals/${throwaway.id}`, { draft: { title: "late" } })).status, 409);
    assert.equal((await json<Item[]>(await call(t, "GET", "/api/items"))).length, 3, "nothing created from the discarded capture");
  });

  it("keeps an NB without a target as a proposal with a warning until a target is supplied", async () => {
    const t = makeTestApp();
    const capture = await postCapture(t, { text: "NB: Expand into Toledo" });
    const [nb] = capture.proposals;
    assert.ok(nb);
    assert.deepEqual(nb.warnings, ["NB needs a target"]);
    const rejected = await call(t, "POST", `/api/captures/${capture.id}/proposals/${nb.id}/accept`);
    assert.equal(rejected.status, 422);
    assert.deepEqual(await rejected.json(), { error: "NB needs a target" });
    const all = await call(t, "POST", `/api/captures/${capture.id}/accept-all`);
    assert.equal(all.status, 422);
    assert.equal((await json<ApiError & { details: { proposalId: string } }>(all)).details.proposalId, nb.id);
    const ok = await call(t, "POST", `/api/captures/${capture.id}/proposals/${nb.id}/accept`, { ownerInitials: "VM" });
    assert.equal(ok.status, 200);
    assert.equal((await json<{ item: Item }>(ok)).item.ownerInitials, "VM");
  });

  it("accepts a JSON body and rejects empty captures / unknown divisions", async () => {
    const t = makeTestApp();
    const capture = await postCapture(t, { text: "Q: DK What is the plan?", context: "   " });
    assert.equal(capture.kind, "text");
    assert.equal(capture.context, null);
    assert.equal(capture.proposals[0]?.draft.ownerInitials, "DK");

    // Nothing to review is not "waiting for review": the capture is filed as reviewed straight away.
    const nothing = await postCapture(t, { text: "just some rambling without a tag" });
    assert.equal(nothing.proposalCount, 0);
    assert.equal(nothing.error, null);
    assert.equal(nothing.status, "reviewed");
    assert.ok(nothing.reviewedAt);
    assert.deepEqual((await json<CaptureSummary[]>(await call(t, "GET", "/api/captures?status=pending"))).map((c) => c.id), [capture.id]);

    assert.equal((await call(t, "POST", "/api/captures", { text: "   " })).status, 422);
    assert.equal((await call(t, "POST", "/api/captures", form({}))).status, 422);
    assert.equal((await call(t, "POST", "/api/captures", { text: "A: x", defaultDivisionCode: "NOPE" })).status, 422);
    const res = await t.app.request("/api/captures", { method: "POST", body: "plain", headers: { cookie: t.cookie, "content-type": "text/plain" } });
    assert.equal(res.status, 415);
  });
});

describe("POST /api/captures (files)", () => {
  it("stores images, infers screenshot / image / mixed and serves the bytes back", async () => {
    const t = makeTestApp();
    const shot = await postCapture(t, form({}, [{ name: "IMG_0001.PNG", type: "image/png" }]));
    assert.equal(shot.kind, "screenshot");
    assert.equal(shot.fileCount, 1);
    assert.equal(shot.proposals.length, 0);
    assert.equal(shot.status, "reviewed", "no proposals, no error: nothing waits in the inbox");
    assert.ok(shot.notes.some((n) => /stored but not analy[sz]ed/.test(n)));
    const meta = shot.files[0];
    assert.ok(meta);
    assert.equal(meta.filename, "IMG_0001.PNG");
    assert.equal(meta.mime, "image/png");
    assert.equal(meta.size, PNG.byteLength);

    const file = await call(t, "GET", `/api/captures/${shot.id}/files/${meta.id}`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "image/png");
    assert.equal(file.headers.get("content-length"), String(PNG.byteLength));
    assert.match(file.headers.get("content-disposition") ?? "", /inline; filename="IMG_0001.PNG"/);
    assert.equal(file.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Array.from(new Uint8Array(await file.arrayBuffer())), Array.from(PNG));
    assert.equal((await call(t, "GET", `/api/captures/${shot.id}/files/nope`)).status, 404);
    assert.equal((await t.app.request(`/api/captures/${shot.id}/files/${meta.id}`)).status, 401, "file bytes require auth");

    const photo = await postCapture(t, form({}, [{ name: "kitchen.jpg", type: "", bytes: JPEG }, { field: "files", name: "door.heic", type: "image/heic", bytes: HEIC }]));
    assert.equal(photo.kind, "image");
    assert.equal(photo.fileCount, 2);
    assert.equal(photo.files[0]?.mime, "image/jpeg", "mime inferred from the extension and confirmed by the bytes");
    assert.equal(photo.files[1]?.mime, "image/heic");

    const mixed = await postCapture(t, form({ text: "A: VM fix the door" }, [{ name: "door.png", type: "image/png" }]));
    assert.equal(mixed.kind, "mixed");
    assert.equal(mixed.proposals.length, 1);
  });

  it("enforces the mime allow-list, the 8-file limit and the 10 MB limit", async () => {
    const t = makeTestApp();
    const pdf = await call(t, "POST", "/api/captures", form({}, [{ name: "notes.pdf", type: "application/pdf" }]));
    assert.equal(pdf.status, 422);
    assert.match((await json<ApiError>(pdf)).error, /Unsupported file type/);

    const many = form({}, Array.from({ length: 9 }, (_, i) => ({ name: `p${i}.png`, type: "image/png" })));
    const tooMany = await call(t, "POST", "/api/captures", many);
    assert.equal(tooMany.status, 422);

    const big = await call(t, "POST", "/api/captures", form({}, [{ name: "big.png", type: "image/png", bytes: new Uint8Array(MAX_FILE_BYTES + 1) }]));
    assert.equal(big.status, 413);

    // The declared type is not trusted: HTML labelled as an image is refused ...
    const html = await call(t, "POST", "/api/captures", form({}, [{ name: "evil.png", type: "image/png", bytes: HTML }]));
    assert.equal(html.status, 422);
    assert.match((await json<ApiError>(html)).error, /not a recognisable JPEG, PNG, HEIC, WebP or GIF image/);
    assert.equal((await json<CaptureSummary[]>(await call(t, "GET", "/api/captures"))).length, 0, "nothing stored on rejection");

    // ... and a mislabelled real image is stored as what its bytes say.
    const mislabelled = await postCapture(t, form({}, [{ name: "really-a-jpeg.png", type: "image/png", bytes: JPEG }]));
    assert.equal(mislabelled.files[0]?.mime, "image/jpeg");
    const served = await call(t, "GET", `/api/captures/${mislabelled.id}/files/${mislabelled.files[0]?.id}`);
    assert.equal(served.headers.get("content-type"), "image/jpeg");
  });
});

describe("injected extractor", () => {
  const fakeExtract: ExtractProposalsFn = async (input, ctx) => ({
    proposals: [
      {
        draft: emptyDraft({ title: `From model (${input.images.length} images, ${ctx.people.length} people)`, ownerInitials: input.defaultDivisionCode ? null : "VM" }),
        confidence: 0.6,
        inferred: true,
        sourceExcerpt: input.text,
        warnings: ["unknown person: Brooke"],
      },
    ],
    model: "fake-model",
    notes: ["hello from the fake"],
  });

  it("is used when provided", async () => {
    const t = makeTestApp({}, { extractProposals: fakeExtract });
    const capture = await postCapture(t, form({ text: "some untagged rambling", defaultDivisionCode: "HG" }, [{ name: "a.png", type: "image/png" }]));
    assert.equal(capture.kind, "mixed");
    assert.equal(capture.proposals.length, 1);
    assert.equal(capture.proposals[0]?.draft.title, "From model (1 images, 12 people)");
    assert.equal(capture.proposals[0]?.inferred, true);
    assert.deepEqual(capture.proposals[0]?.warnings, ["unknown person: Brooke"]);
    assert.deepEqual(capture.notes, ["hello from the fake", "Model: fake-model"]);
  });

  it("records extraction failures on the capture and lets re-extract recover, keeping accepted proposals", async () => {
    let calls = 0;
    const flaky: ExtractProposalsFn = async (input, ctx) => {
      calls += 1;
      if (calls === 1) throw new Error("boom: rate limited");
      const base = await fakeExtract(input, ctx);
      if (calls < 4) return base;
      // From the fourth run on, the extractor also finds a genuinely new line.
      return {
        ...base,
        proposals: [
          ...base.proposals,
          { draft: emptyDraft({ title: "Brand new follow-up", ownerInitials: "DK" }), confidence: 0.6, inferred: true, sourceExcerpt: "Dave asked for a brand new follow-up on the permit", warnings: [] },
        ],
      };
    };
    const t = makeTestApp({}, { extractProposals: flaky });
    const failed = await postCapture(t, { text: "A: VM something" });
    assert.equal(failed.status, "pending");
    assert.match(failed.error ?? "", /boom: rate limited/);
    assert.equal(failed.proposals.length, 0);

    const retried = await json<Capture>(await call(t, "POST", `/api/captures/${failed.id}/reextract`));
    assert.equal(retried.error, null);
    assert.equal(retried.status, "pending");
    assert.equal(retried.proposals.length, 1);
    const first = retried.proposals[0];
    assert.ok(first);
    await call(t, "POST", `/api/captures/${failed.id}/proposals/${first.id}/accept`);
    assert.equal((await json<Capture>(await call(t, "GET", `/api/captures/${failed.id}`))).status, "reviewed");

    // The same line again: nothing is re-proposed, the capture stays reviewed, and the note says why.
    const same = await json<Capture>(await call(t, "POST", `/api/captures/${failed.id}/reextract`));
    assert.equal(same.status, "reviewed", "no new proposal, so nothing re-opens");
    assert.deepEqual(same.proposals.map((p) => p.state), ["accepted"]);
    assert.ok(same.notes.some((n) => /1 proposal matched lines already accepted or rejected and was not proposed again/.test(n)), JSON.stringify(same.notes));
    assert.equal((await json<Item[]>(await call(t, "GET", "/api/items"))).length, 1);
    assert.equal((await call(t, "POST", `/api/captures/${failed.id}/accept-all`)).status, 200, "accept-all has nothing to duplicate");
    assert.equal((await json<Item[]>(await call(t, "GET", "/api/items"))).length, 1, "no duplicate items");

    // A genuinely new line is proposed and re-opens the capture for review.
    const fresh = await json<Capture>(await call(t, "POST", `/api/captures/${failed.id}/reextract`));
    assert.equal(fresh.status, "pending", "re-opened for review");
    assert.equal(fresh.reviewedAt, null);
    assert.deepEqual(fresh.proposals.map((p) => [p.state, p.draft.title]), [
      ["accepted", "From model (0 images, 12 people)"],
      ["proposed", "Brand new follow-up"],
    ]);
    assert.equal((await call(t, "POST", "/api/captures/nope/reextract")).status, 404);
  });

  it("re-extract on a rejected-only capture with nothing new leaves it reviewed", async () => {
    const t = makeTestApp({}, { extractProposals: fakeExtract });
    const capture = await postCapture(t, { text: "untagged thoughts" });
    const [only] = capture.proposals;
    assert.ok(only);
    await call(t, "POST", `/api/captures/${capture.id}/proposals/${only.id}/reject`);
    const after = await json<Capture>(await call(t, "POST", `/api/captures/${capture.id}/reextract`));
    assert.equal(after.status, "reviewed");
    assert.equal(after.proposedCount, 0);
    assert.deepEqual(after.proposals.map((p) => p.state), ["rejected"]);
    assert.equal((await json<{ pendingCaptures: number }>(await call(t, "GET", "/api/today"))).pendingCaptures, 0);
  });
});

describe("import routes", () => {
  it("answers 501 for preview when no importer is wired", async () => {
    const t = makeTestApp();
    const res = await call(t, "POST", "/api/import/preview", form({}, [{ field: "file", name: "brain.xlsm", type: "application/octet-stream" }]));
    assert.equal(res.status, 501);
    assert.deepEqual(await res.json(), { error: "Importer not wired" });
  });

  it("previews through the injected parser and commits rows as items with an import capture", async () => {
    const parseImportFile: ParseImportFileFn = async (file, ctx) => ({
      filename: file.filename,
      sheetNames: ["Brain Dump"],
      detectedTables: ["Action Items"],
      rows: [
        {
          table: "Action Items",
          sheet: "Brain Dump",
          rowNumber: 4,
          raw: { Note: "Call Vince", Division: "Henderson Glass" },
          draft: emptyDraft({ title: "Call Vince", divisionCode: ctx.divisions[0]?.code ?? null }),
          warnings: [],
          include: true,
        },
      ],
    });
    const t = makeTestApp({}, { parseImportFile });
    const preview = await call(t, "POST", "/api/import/preview", form({}, [{ field: "file", name: "brain.xlsm", type: "application/octet-stream" }]));
    assert.equal(preview.status, 200);
    const body = await json<ImportPreview>(preview);
    assert.equal(body.filename, "brain.xlsm");
    assert.equal(body.rows.length, 1);
    assert.equal((await call(t, "POST", "/api/import/preview", form({ file: "not a file" }))).status, 422);

    const commit = await call(t, "POST", "/api/import/commit", {
      filename: "brain.xlsm",
      rows: [
        ...body.rows,
        { table: "New Business", sheet: "Brain Dump", rowNumber: 9, raw: {}, draft: emptyDraft({ title: "Toledo", category: "NB", divisionCode: "HG", status: "Parked" }), warnings: ["x"], include: true },
        { table: "Watch List", sheet: "Brain Dump", rowNumber: 12, raw: {}, draft: emptyDraft({ title: "Skipped", category: "W" }), warnings: [], include: false },
      ],
    });
    assert.equal(commit.status, 201, JSON.stringify(await commit.clone().json()));
    const result = await json<ImportCommitResult>(commit);
    assert.equal(result.created, 2);
    assert.deepEqual(result.items.map((i) => i.title), ["Call Vince", "Toledo"]);
    assert.ok(result.items.every((i) => i.sourceCaptureId === result.captureId));
    const capture = await json<Capture>(await call(t, "GET", `/api/captures/${result.captureId}`));
    assert.equal(capture.kind, "import");
    assert.equal(capture.status, "reviewed");
    assert.equal(capture.title, "Import: brain.xlsm");
    assert.deepEqual(capture.proposals.map((p) => p.state), ["accepted", "accepted"]);
    assert.ok(capture.notes[0]?.startsWith("Imported 2 row(s)"));

    const bad = await call(t, "POST", "/api/import/commit", {
      rows: [{ table: "New Business", sheet: "S", rowNumber: 3, raw: {}, draft: emptyDraft({ title: "No target", category: "NB" }), warnings: [], include: true }],
    });
    assert.equal(bad.status, 422);
    const err = await json<ApiError & { details: { rowNumber: number } }>(bad);
    assert.match(err.error, /Row 3 \(New Business\): NB needs a target/);
    assert.equal(err.details.rowNumber, 3);
    assert.equal((await json<Item[]>(await call(t, "GET", "/api/items?includeDone=1"))).length, 2, "failed commit created nothing");
    assert.equal((await call(t, "POST", "/api/import/commit", { rows: [] })).status, 422);
    assert.equal((await call(t, "POST", "/api/import/commit", { rows: [{ include: false }] })).status, 422);
  });
});
