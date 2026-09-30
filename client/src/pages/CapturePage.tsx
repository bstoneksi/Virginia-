import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { CaptureKind, CaptureStatus, CaptureSummary } from "@shared/types";
import { api, errorMessage } from "@/api";
import { Chip, DivisionChip } from "@/components/Badges";
import { Button, Field, Segmented, Select, TextArea, TextInput } from "@/components/Field";
import { Icon, type IconName } from "@/components/Icon";
import { EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/States";
import { useBootstrap } from "@/lib/bootstrap";
import { formatRelative } from "@/lib/dates";
import { usePageTitle, usePendingCaptures } from "@/lib/shell";
import { useToast } from "@/lib/toast";
import { useQuery } from "@/lib/useQuery";

const PLACEHOLDER = `A:VM Send updated glass quote — HG due 10/15
Q:DK When does the new install crew start? K&B-I
NB:PH Cabinets Express wants a joint promo
D: Moving the RF warehouse move to Q1
W: PF permit backlog in Macomb — watch it
I: Bundle APP + K&B for builder accounts
A: PTD Renew passport by 11/1

…or paste a transcript / voice-memo text and Claude will propose items for review.`;

const MAX_FILES = 8;
const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_RE = /^image\/(jpeg|png|heic|heif|webp|gif)$/i;
/** Formats the model analyses; the server also stores HEIC/HEIF but Claude cannot read them. */
const MODEL_IMAGE_TYPES = "image/jpeg,image/png,image/webp,image/gif";

export const KIND_ICON: Record<CaptureKind, IconName> = {
  text: "text",
  transcript: "text",
  image: "camera",
  screenshot: "image",
  mixed: "image",
  import: "upload",
};

function acceptable(file: File): string | null {
  const okType = IMAGE_RE.test(file.type) || (!file.type && /\.(heic|heif|jpe?g|png|webp|gif)$/i.test(file.name));
  if (!okType) return `${file.name}: only JPEG, PNG, HEIC, WebP or GIF images`;
  if (file.size > MAX_BYTES) return `${file.name}: larger than 10 MB`;
  return null;
}

function CaptureRow({ capture }: { capture: CaptureSummary }) {
  const { division } = useBootstrap();
  return (
    <li className="border-b border-slate-100 last:border-b-0">
      <Link to={`/capture/${capture.id}`} className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-slate-50">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${capture.error ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>
          <Icon name={capture.error ? "alert" : KIND_ICON[capture.kind]} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">{capture.title || capture.context || `${capture.kind} capture`}</p>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span>{formatRelative(capture.createdAt)}</span>
            {capture.defaultDivisionCode && <DivisionChip division={division(capture.defaultDivisionCode)} code={capture.defaultDivisionCode} />}
            {capture.fileCount > 0 && <Chip>{capture.fileCount} image{capture.fileCount === 1 ? "" : "s"}</Chip>}
            {capture.error ? <span className="text-red-700">extraction failed</span> : <Chip>{capture.status === "pending" ? `${capture.proposedCount} to review` : `${capture.proposalCount} proposal${capture.proposalCount === 1 ? "" : "s"}`}</Chip>}
          </p>
        </div>
        <Icon name="chevronRight" className="h-4 w-4 text-slate-300" />
      </Link>
    </li>
  );
}

export function CapturePage() {
  usePageTitle("Inbox");
  const { divisions, aiConfigured } = useBootstrap();
  const navigate = useNavigate();
  const toast = useToast();
  const pending = usePendingCaptures();
  const [text, setText] = useState("");
  const [context, setContext] = useState("");
  const [divisionCode, setDivisionCode] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [listStatus, setListStatus] = useState<CaptureStatus>("pending");
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const list = useQuery((signal) => api.captures.list(listStatus, signal), [listStatus]);

  const previews = useMemo(() => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const next = [...files];
    for (const file of Array.from(incoming)) {
      const problem = acceptable(file);
      if (problem) {
        toast.error(problem);
        continue;
      }
      if (next.length >= MAX_FILES) {
        toast.error(`Up to ${MAX_FILES} images per capture`);
        break;
      }
      next.push(file);
    }
    setFiles(next);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() && files.length === 0) {
      toast.error("Paste some notes or add a photo first");
      return;
    }
    setBusy(true);
    try {
      const capture = await api.captures.create({ text: text.trim(), context: context.trim(), defaultDivisionCode: divisionCode || null, files });
      setText("");
      setContext("");
      setFiles([]);
      void pending.refresh();
      if (capture.error) toast.error("Saved, but extraction failed — you can retry from the review screen");
      else toast.success(`${capture.proposals?.length ?? 0} proposal${capture.proposals?.length === 1 ? "" : "s"} ready for review`);
      navigate(`/capture/${capture.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 md:p-4">
        <TextArea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder={PLACEHOLDER} aria-label="Notes or transcript" className="font-mono text-[13px] md:text-sm" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Context">
            <TextInput value={context} onChange={(e) => setContext(e.target.value)} placeholder='e.g. "1:1 with VM 9/30"' autoComplete="off" />
          </Field>
          <Field label="Default division">
            <Select value={divisionCode} onChange={(e) => setDivisionCode(e.target.value)}>
              <option value="">— none —</option>
              {divisions.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.code} · {d.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* Only the formats Claude can read are listed: iOS then transcodes HEIC photos to JPEG on upload
            instead of sending HEIC, which the server would store but could not analyse. */}
        <input ref={cameraRef} type="file" accept={MODEL_IMAGE_TYPES} capture="environment" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        <input ref={libraryRef} type="file" accept={MODEL_IMAGE_TYPES} multiple hidden onChange={(e) => addFiles(e.target.files)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => cameraRef.current?.click()}>
            <Icon name="camera" className="h-4 w-4" /> Take photo
          </Button>
          <Button variant="secondary" onClick={() => libraryRef.current?.click()}>
            <Icon name="image" className="h-4 w-4" /> Add screenshots
          </Button>
          <span className="text-xs text-slate-400">Handwritten pages, texts, whiteboards. Up to 8.</span>
        </div>
        {previews.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {previews.map((p, idx) => (
              <li key={`${p.file.name}-${idx}`} className="relative">
                <img src={p.url} alt={p.file.name} className="h-20 w-20 rounded-md border border-slate-200 object-cover" />
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, i) => i !== idx))}
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-white"
                  aria-label={`Remove ${p.file.name}`}
                >
                  <Icon name="x" className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {!aiConfigured && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            AI extraction is off (no <code>ANTHROPIC_API_KEY</code>). Only lines with an explicit tag such as <code>A:</code> or <code>NB:</code> will be parsed; photos need the key.
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={busy || (!text.trim() && files.length === 0)}>
            {busy ? "Extracting…" : "Capture & review"}
          </Button>
        </div>
      </form>

      <section>
        <SectionHeader
          title="Captures"
          right={
            <Segmented<CaptureStatus>
              size="sm"
              value={listStatus}
              onChange={setListStatus}
              options={[
                { value: "pending", label: `Pending${pending.count ? ` (${pending.count})` : ""}` },
                { value: "reviewed", label: "Reviewed" },
                { value: "discarded", label: "Discarded" },
              ]}
            />
          }
        />
        {list.loading && !list.data && <LoadingState />}
        {list.error && !list.data && <ErrorState error={list.error} onRetry={() => void list.reload(false)} />}
        {list.data && list.data.length === 0 && (
          <EmptyState compact title={listStatus === "pending" ? "Inbox is clear" : `No ${listStatus} captures`} hint={listStatus === "pending" ? "Paste notes or snap a page above to get proposals." : undefined} />
        )}
        {list.data && list.data.length > 0 && (
          <ul className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            {list.data.map((c) => (
              <CaptureRow key={c.id} capture={c} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
