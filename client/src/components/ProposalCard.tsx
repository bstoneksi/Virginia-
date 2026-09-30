import { useEffect, useRef, useState } from "react";
import type { Item, ItemDraft, Proposal } from "@shared/types";
import { api, errorMessage } from "@/api";
import { useBootstrap } from "@/lib/bootstrap";
import { isDraftDirty, normalizeDraft, validateDraft } from "@/lib/drafts";
import { emitItemChange } from "@/lib/itemEvents";
import { useToast } from "@/lib/toast";
import { CategoryBadge, DivisionChip, DueChip, InferredTag, OwnerChip, PriorityDot, StatusChip } from "./Badges";
import { Button, compactTapClass } from "./Field";
import { Icon } from "./Icon";
import { ItemFields } from "./ItemFields";

interface ProposalCardProps {
  captureId: string;
  proposal: Proposal;
  onResolved: (proposal: Proposal, item?: Item) => void;
  onDraftSaved: (proposal: Proposal) => void;
}

export function ProposalCard({ captureId, proposal, onResolved, onDraftSaved }: ProposalCardProps) {
  const toast = useToast();
  const { division, person } = useBootstrap();
  const [draft, setDraft] = useState<ItemDraft>(proposal.draft);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const savedRef = useRef<ItemDraft>(proposal.draft);

  // Persist edits to the proposal (debounced) so nothing is lost if the user navigates away.
  useEffect(() => {
    if (!isDraftDirty(savedRef.current, draft)) return;
    const id = window.setTimeout(async () => {
      try {
        const updated = await api.captures.updateProposal(captureId, proposal.id, normalizeDraft(draft));
        savedRef.current = draft;
        if (updated && typeof updated === "object") onDraftSaved({ ...updated, draft: updated.draft ?? draft });
      } catch {
        /* keep local edits; Accept sends them as overrides anyway */
      }
    }, 700);
    return () => window.clearTimeout(id);
  }, [draft, captureId, proposal.id, onDraftSaved]);

  const accept = async () => {
    const clean = normalizeDraft(draft);
    const problem = validateDraft(clean);
    if (problem) {
      toast.error(problem);
      setEditing(true);
      return;
    }
    setBusy("accept");
    try {
      const result = await api.captures.accept(captureId, proposal.id, clean);
      emitItemChange({ type: "created", item: result.item });
      onResolved(result.proposal, result.item);
      toast.success(`Added ${result.item.category}: ${result.item.title}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    setBusy("reject");
    try {
      const updated = await api.captures.reject(captureId, proposal.id);
      onResolved(updated ?? { ...proposal, state: "rejected" });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const confidence = Math.round(proposal.confidence * 100);
  const lowConfidence = proposal.confidence < 0.6;

  return (
    <article className={`rounded-xl border bg-white shadow-sm ${proposal.warnings.length ? "border-amber-300" : "border-slate-200"}`}>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryBadge category={draft.category} label />
          {proposal.inferred && <InferredTag />}
          <span className={`text-[11px] ${lowConfidence ? "text-amber-700" : "text-slate-400"}`} title="Extractor confidence">
            {confidence}% confident
          </span>
          <button type="button" onClick={() => setEditing((v) => !v)} className={`ml-auto inline-flex ${compactTapClass} items-center gap-1 rounded-md px-3 text-xs font-medium text-brand hover:bg-slate-100 md:px-2`}>
            <Icon name="edit" className="h-3.5 w-3.5" /> {editing ? "Done editing" : "Edit"}
          </button>
        </div>

        {editing ? (
          <ItemFields draft={draft} onChange={setDraft} compact showStatus idPrefix={`p-${proposal.id}`} />
        ) : (
          <>
            <p className="break-words text-sm font-medium text-slate-900">{draft.title || <span className="italic text-red-600">Untitled — edit before accepting</span>}</p>
            {draft.note && <p className="whitespace-pre-wrap break-words text-xs text-slate-600">{draft.note}</p>}
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
              <OwnerChip initials={draft.ownerInitials} name={person(draft.ownerInitials)?.fullName} />
              {draft.isPersonal ? <DivisionChip code="PTD" division={division("PTD")} /> : <DivisionChip division={division(draft.divisionCode)} code={draft.divisionCode} />}
              <DueChip dueDate={draft.dueDate} status={draft.status} />
              <span className="inline-flex items-center gap-1">
                <PriorityDot priority={draft.priority} /> {draft.priority}
              </span>
              {draft.status !== "Open" && <StatusChip status={draft.status} />}
              {draft.initiativeName && <span className="text-slate-400">· {draft.initiativeName}</span>}
            </div>
          </>
        )}

        {proposal.warnings.length > 0 && (
          <ul className="flex flex-col gap-0.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            {proposal.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
              </li>
            ))}
          </ul>
        )}
        {proposal.sourceExcerpt && (
          <blockquote className="border-l-2 border-slate-200 pl-2 text-xs italic text-slate-500">
            <span className="whitespace-pre-wrap break-words">{proposal.sourceExcerpt}</span>
          </blockquote>
        )}
      </div>
      <div className="flex gap-2 border-t border-slate-100 px-3 py-2">
        <Button variant="ghost" onClick={() => void reject()} disabled={busy !== null} className="text-slate-600">
          <Icon name="x" className="h-4 w-4" /> {busy === "reject" ? "…" : "Reject"}
        </Button>
        <div className="flex-1" />
        <Button variant="primary" onClick={() => void accept()} disabled={busy !== null}>
          <Icon name="check" className="h-4 w-4" /> {busy === "accept" ? "Adding…" : "Accept"}
        </Button>
      </div>
    </article>
  );
}
