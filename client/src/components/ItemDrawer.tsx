import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { ItemDraft, Status } from "@shared/types";
import { STATUSES, STATUS_COLORS } from "@shared/types";
import { api, errorMessage, type ItemDetail } from "@/api";
import { useBootstrap } from "@/lib/bootstrap";
import { useConfirm } from "@/lib/confirm";
import { formatDateTime } from "@/lib/dates";
import { draftDiff, isDraftDirty, itemToDraft, normalizeDraft, validateDraft } from "@/lib/drafts";
import { emitItemChange } from "@/lib/itemEvents";
import { useToast } from "@/lib/toast";
import { useQuery } from "@/lib/useQuery";
import { CategoryBadge, StatusChip } from "./Badges";
import { Button, IconButton } from "./Field";
import { Icon } from "./Icon";
import { ItemFields } from "./ItemFields";
import { ItemHistory } from "./ItemHistory";
import { Sheet } from "./Sheet";
import { ErrorState, LoadingState } from "./States";

interface ItemDrawerProps {
  itemId: string | null;
  onClose: () => void;
}

/** Shared item editor: every field, status buttons, comments + history, source capture, delete. */
export function ItemDrawer({ itemId, onClose }: ItemDrawerProps) {
  const { initiativeName } = useBootstrap();
  const toast = useToast();
  const confirm = useConfirm();
  const detail = useQuery<ItemDetail | null>(() => (itemId ? api.items.get(itemId) : Promise.resolve(null)), [itemId]);
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [base, setBase] = useState<ItemDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState<Status | null>(null);

  const item = detail.data ?? null;

  useEffect(() => {
    if (item) {
      const d = itemToDraft(item, initiativeName);
      setDraft(d);
      setBase(d);
    } else {
      setDraft(null);
      setBase(null);
    }
  }, [item, initiativeName]);

  const dirty = draft !== null && base !== null && isDraftDirty(base, draft);

  const requestClose = useCallback(() => {
    if (dirty) {
      void confirm({ title: "Discard unsaved changes?", confirmLabel: "Discard", danger: true }).then((ok) => {
        if (ok) onClose();
      });
      return;
    }
    onClose();
  }, [dirty, confirm, onClose]);

  const save = async () => {
    if (!item || !draft || !base) return;
    const clean = normalizeDraft(draft);
    const problem = validateDraft(clean);
    if (problem) {
      toast.error(problem);
      return;
    }
    const patch = draftDiff(base, clean);
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    try {
      const updated = await api.items.update(item.id, patch);
      emitItemChange({ type: "updated", item: updated });
      toast.success("Saved");
      await detail.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status: Status) => {
    if (!item || item.status === status) return;
    setStatusBusy(status);
    try {
      const updated = await api.items.update(item.id, { status });
      emitItemChange({ type: "updated", item: updated });
      await detail.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStatusBusy(null);
    }
  };

  const remove = async () => {
    if (!item) return;
    const ok = await confirm({
      title: "Delete this item permanently?",
      message: "Done items are normally kept forever. Deleting removes it and its history for good.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.items.remove(item.id);
      emitItemChange({ type: "deleted", id: item.id });
      toast.success("Item deleted");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const comment = async (text: string) => {
    if (!item) return;
    try {
      await api.items.comment(item.id, text);
      await detail.reload();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  return (
    <Sheet
      open={itemId !== null}
      onClose={requestClose}
      title={
        item ? (
          <span className="flex items-center gap-2">
            <CategoryBadge category={item.category} label />
            <StatusChip status={item.status} />
          </span>
        ) : (
          "Item"
        )
      }
      footer={
        item && (
          <div className="flex items-center gap-2">
            <IconButton label="Delete item" onClick={() => void remove()} className="text-red-600 hover:bg-red-50">
              <Icon name="trash" />
            </IconButton>
            <div className="flex-1" />
            <Button variant="secondary" onClick={requestClose}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )
      }
    >
      {detail.loading && !item && <LoadingState />}
      {detail.error && !item && <ErrorState error={detail.error} onRetry={() => void detail.reload(false)} />}
      {item && draft && (
        <div className="flex flex-col gap-5">
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</h3>
            <div className="grid grid-cols-4 gap-1.5">
              {STATUSES.map((s) => {
                const active = item.status === s;
                const c = STATUS_COLORS[s];
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={statusBusy !== null}
                    onClick={() => void changeStatus(s)}
                    style={active ? { background: c.bg, color: c.fg, borderColor: c.fg } : undefined}
                    className={`min-h-11 rounded-md border px-1 text-xs font-semibold leading-tight ${active ? "" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                  >
                    {statusBusy === s ? "…" : s}
                  </button>
                );
              })}
            </div>
          </section>

          <ItemFields draft={draft} onChange={setDraft} showStatus={false} idPrefix="drawer" />

          <section className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <p>
              Created {formatDateTime(item.createdAt)} · Updated {formatDateTime(item.updatedAt)}
              {item.completedAt && <> · Completed {formatDateTime(item.completedAt)}</>}
            </p>
            {item.sourceCaptureId && (
              <p className="mt-1">
                <Link to={`/capture/${item.sourceCaptureId}`} onClick={onClose} className="inline-flex items-center gap-1 font-medium text-brand underline">
                  <Icon name="link" className="h-3.5 w-3.5" />
                  Source capture{detail.data?.capture?.title ? `: ${detail.data.capture.title}` : ""}
                </Link>
              </p>
            )}
          </section>

          <ItemHistory events={detail.data?.events ?? []} onComment={comment} />
        </div>
      )}
    </Sheet>
  );
}
