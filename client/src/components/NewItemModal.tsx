import { useEffect, useState } from "react";
import type { Item, ItemDraft } from "@shared/types";
import { emptyDraft } from "@shared/types";
import { api, errorMessage } from "@/api";
import { normalizeDraft, validateDraft } from "@/lib/drafts";
import { emitItemChange } from "@/lib/itemEvents";
import { useToast } from "@/lib/toast";
import { Button } from "./Field";
import { ItemFields } from "./ItemFields";
import { Sheet } from "./Sheet";

interface NewItemModalProps {
  open: boolean;
  onClose: () => void;
  initial?: Partial<ItemDraft>;
  onCreated?: (item: Item) => void;
}

export function NewItemModal({ open, onClose, initial, onCreated }: NewItemModalProps) {
  const toast = useToast();
  const [draft, setDraft] = useState<ItemDraft>(() => emptyDraft(initial));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setDraft(emptyDraft(initial));
    // Reset only when (re)opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const create = async () => {
    const clean = normalizeDraft(draft);
    const problem = validateDraft(clean);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      const item = await api.items.create(clean);
      emitItemChange({ type: "created", item });
      toast.success("Item created");
      onCreated?.(item);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="center"
      title="New item"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void create()} disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </div>
      }
    >
      <ItemFields draft={draft} onChange={setDraft} autoFocusTitle idPrefix="new" />
    </Sheet>
  );
}
