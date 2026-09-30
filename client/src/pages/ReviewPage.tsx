import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Capture, Item, Proposal } from "@shared/types";
import { api, errorMessage } from "@/api";
import { CategoryBadge, Chip, DivisionChip } from "@/components/Badges";
import { Button } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { ProposalCard } from "@/components/ProposalCard";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useBootstrap } from "@/lib/bootstrap";
import { useConfirm } from "@/lib/confirm";
import { formatDateTime } from "@/lib/dates";
import { useItemDrawer } from "@/lib/drawer";
import { emitItemChange } from "@/lib/itemEvents";
import { usePageTitle, usePendingCaptures } from "@/lib/shell";
import { useToast } from "@/lib/toast";
import { useQuery } from "@/lib/useQuery";
import { KIND_ICON } from "./CapturePage";

export function ReviewPage() {
  const { id = "" } = useParams();
  usePageTitle("Review");
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const pending = usePendingCaptures();
  const { division } = useBootstrap();
  const { openItem } = useItemDrawer();
  const capture = useQuery<Capture>((signal) => api.captures.get(id, signal), [id]);
  const [busy, setBusy] = useState<"all" | "reextract" | "discard" | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const patchProposal = useCallback(
    (next: Proposal) => {
      capture.setData((prev) => (prev ? { ...prev, proposals: prev.proposals.map((p) => (p.id === next.id ? { ...p, ...next } : p)) } : prev));
    },
    [capture],
  );

  const onResolved = useCallback(
    (proposal: Proposal, _item?: Item) => {
      patchProposal(proposal);
      void pending.refresh();
    },
    [patchProposal, pending],
  );

  const acceptAll = async () => {
    const remaining = data?.proposals.filter((p) => p.state === "proposed").length ?? 0;
    if (!remaining) return;
    const ok = await confirm({ title: `Accept all ${remaining} remaining proposal${remaining === 1 ? "" : "s"}?`, message: "Each becomes an item with its current draft.", confirmLabel: "Accept all" });
    if (!ok) return;
    setBusy("all");
    try {
      const result = await api.captures.acceptAll(id);
      for (const item of result.items ?? []) emitItemChange({ type: "created", item });
      toast.success(`${result.items?.length ?? remaining} item${(result.items?.length ?? remaining) === 1 ? "" : "s"} created`);
      await capture.reload();
      void pending.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const reextract = async () => {
    const ok = await confirm({
      title: "Run extraction again?",
      message: "Proposals you haven't accepted or rejected are replaced. Accepted and rejected ones are kept, and their lines are not proposed again.",
      confirmLabel: "Re-extract",
    });
    if (!ok) return;
    setBusy("reextract");
    try {
      const result = await api.captures.reextract(id);
      if (result && typeof result === "object" && "proposals" in result) capture.setData(result);
      else await capture.reload();
      toast.success("Extraction finished");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    const ok = await confirm({ title: "Discard this capture?", message: "Remaining proposals are dropped. Items you already accepted stay.", confirmLabel: "Discard", danger: true });
    if (!ok) return;
    setBusy("discard");
    try {
      await api.captures.discard(id);
      void pending.refresh();
      toast.success("Capture discarded");
      navigate("/capture");
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(null);
    }
  };

  const data = capture.data;
  if (capture.loading && !data) return <LoadingState label="Loading capture…" />;
  if (capture.error && !data) return <ErrorState error={capture.error} onRetry={() => void capture.reload(false)} />;
  if (!data) return null;

  const sorted = [...data.proposals].sort((a, b) => a.sortOrder - b.sortOrder);
  const proposed = sorted.filter((p) => p.state === "proposed");
  const resolved = sorted.filter((p) => p.state !== "proposed");
  const accepted = resolved.filter((p) => p.state === "accepted");

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Link to="/capture" className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Back to inbox">
            <Icon name="chevronLeft" />
          </Link>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <Icon name={KIND_ICON[data.kind]} className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-slate-900">{data.title || data.context || `${data.kind} capture`}</h2>
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <span>{formatDateTime(data.createdAt)}</span>
              {data.context && data.title && <span>· {data.context}</span>}
              {data.defaultDivisionCode && <DivisionChip division={division(data.defaultDivisionCode)} code={data.defaultDivisionCode} />}
              <Chip>{data.status}</Chip>
            </p>
          </div>
        </div>

        {data.error && (
          <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 sm:flex-row sm:items-center">
            <Icon name="alert" className="h-5 w-5 shrink-0" />
            <p className="flex-1 break-words">
              <strong>Extraction failed:</strong> {data.error}
            </p>
            <Button variant="secondary" size="sm" onClick={() => void reextract()} disabled={busy !== null}>
              <Icon name="refresh" className="h-4 w-4" /> {busy === "reextract" ? "Retrying…" : "Retry extraction"}
            </Button>
          </div>
        )}
        {data.notes.length > 0 && (
          <ul className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
            {data.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}

        {data.files.length > 0 && (
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {data.files.map((f) => (
              <li key={f.id} className="shrink-0">
                <a href={api.captures.fileUrl(data.id, f.id)} target="_blank" rel="noreferrer" title={f.filename}>
                  <img src={api.captures.fileUrl(data.id, f.id)} alt={f.filename} className="h-28 w-28 rounded-md border border-slate-200 object-cover" loading="lazy" />
                </a>
              </li>
            ))}
          </ul>
        )}
        {data.rawText && (
          <details className="rounded-md border border-slate-200 bg-white">
            <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm font-medium text-slate-700">Source text</summary>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-slate-100 px-3 py-2 font-sans text-xs text-slate-700">{data.rawText}</pre>
          </details>
        )}
      </header>

      {data.status !== "discarded" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-600">
            <strong>{proposed.length}</strong> to review · {accepted.length} accepted · {resolved.length - accepted.length} rejected
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => void reextract()} disabled={busy !== null}>
              <Icon name="refresh" className="h-4 w-4" /> Re-extract
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void discard()} disabled={busy !== null} className="text-red-700">
              <Icon name="trash" className="h-4 w-4" /> Discard
            </Button>
            <Button variant="primary" size="sm" onClick={() => void acceptAll()} disabled={busy !== null || proposed.length === 0}>
              <Icon name="check" className="h-4 w-4" /> Accept all ({proposed.length})
            </Button>
          </div>
        </div>
      )}

      {proposed.length === 0 && !data.error && (
        <EmptyState
          compact
          title={accepted.length ? `All reviewed — ${accepted.length} item${accepted.length === 1 ? "" : "s"} created` : data.status === "discarded" ? "This capture was discarded" : "No proposals from this capture"}
          hint={proposed.length === 0 && accepted.length === 0 && !resolved.length ? "Nothing actionable was found. Try re-extracting, or add items by hand on the board." : undefined}
          action={
            <div className="flex gap-3">
              <Link to="/board" className="text-sm font-medium text-brand underline">
                Open the board
              </Link>
              <Link to="/capture" className="text-sm font-medium text-brand underline">
                Back to inbox
              </Link>
            </div>
          }
        />
      )}

      <div className="flex flex-col gap-3">
        {proposed.map((p) => (
          <ProposalCard key={p.id} captureId={data.id} proposal={p} onResolved={onResolved} onDraftSaved={patchProposal} />
        ))}
      </div>

      {resolved.length > 0 && (
        <section>
          <button type="button" onClick={() => setShowResolved((v) => !v)} className="flex min-h-11 items-center gap-1 text-sm font-medium text-slate-600">
            <Icon name="chevronDown" className={`h-4 w-4 transition-transform ${showResolved ? "" : "-rotate-90"}`} />
            {resolved.length} resolved
          </button>
          {showResolved && (
            <ul className="rounded-lg border border-slate-200 bg-white px-3">
              {resolved.map((p) => (
                <li key={p.id} className="flex min-h-11 items-center gap-2 border-b border-slate-100 py-2 last:border-b-0">
                  <CategoryBadge category={p.draft.category} />
                  <span className={`min-w-0 flex-1 truncate text-sm ${p.state === "rejected" ? "text-slate-400 line-through" : "text-slate-800"}`}>{p.draft.title}</span>
                  {p.state === "accepted" && p.itemId ? (
                    <button type="button" onClick={() => openItem(p.itemId as string)} className="min-h-11 px-2 text-xs font-medium text-brand underline">
                      Open item
                    </button>
                  ) : (
                    <Chip>{p.state}</Chip>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
