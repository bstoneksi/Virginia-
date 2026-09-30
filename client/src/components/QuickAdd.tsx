import { useMemo, useState, type FormEvent } from "react";
import type { Item, ItemDraft } from "@shared/types";
import { api, errorMessage } from "@/api";
import { useBootstrap } from "@/lib/bootstrap";
import { validateDraft, normalizeDraft } from "@/lib/drafts";
import { emitItemChange } from "@/lib/itemEvents";
import { parseQuickAdd } from "@/lib/quickParse";
import { useToast } from "@/lib/toast";
import { CategoryBadge, DivisionChip, DueChip, OwnerChip, PriorityDot } from "./Badges";
import { Button, TextInput } from "./Field";

interface QuickAddProps {
  /** Fields applied before parsing (e.g. owner for a person's agenda, isPersonal for the Personal page). */
  defaults?: Partial<ItemDraft>;
  placeholder?: string;
  onCreated?: (item: Item) => void;
  className?: string;
}

/** One-line add box. Understands the note grammar: "A:VM Send glass quote — HG due 10/15 !!". */
export function QuickAdd({ defaults, placeholder, onCreated, className = "" }: QuickAddProps) {
  const { people, divisions, me, division, person } = useBootstrap();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => {
    if (!text.trim()) return null;
    const parsed = parseQuickAdd(text, { people, divisions }, defaults);
    if (parsed.category === "A" && !parsed.ownerInitials && me && defaults?.ownerInitials === undefined) parsed.ownerInitials = me.initials;
    return parsed;
  }, [text, people, divisions, defaults, me]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!preview) return;
    const draft = normalizeDraft(preview);
    const problem = validateDraft(draft);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      const item = await api.items.create(draft);
      emitItemChange({ type: "created", item });
      onCreated?.(item);
      setText("");
      toast.success(`Added ${item.category}: ${item.title}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex gap-2">
        <TextInput
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder ?? "Quick add — A:VM Send updated glass quote — HG due 10/15"}
          aria-label="Quick add"
          autoComplete="off"
          enterKeyHint="done"
        />
        <Button type="submit" variant="primary" disabled={busy || !text.trim()} className="shrink-0">
          {busy ? "…" : "Add"}
        </Button>
      </div>
      {preview && (
        <div className="flex flex-wrap items-center gap-1.5 px-1 text-xs text-slate-500">
          <CategoryBadge category={preview.category} label />
          <OwnerChip initials={preview.ownerInitials} name={person(preview.ownerInitials)?.fullName} />
          {preview.isPersonal ? <DivisionChip code="PTD" division={division("PTD")} /> : <DivisionChip division={division(preview.divisionCode)} code={preview.divisionCode} />}
          <DueChip dueDate={preview.dueDate} status={preview.status} />
          {preview.priority !== "Medium" && (
            <span className="inline-flex items-center gap-1">
              <PriorityDot priority={preview.priority} /> {preview.priority}
            </span>
          )}
          {preview.status === "Parked" && <span>Parked</span>}
          {preview.title ? <span className="truncate text-slate-400">“{preview.title}”</span> : <span className="text-red-600">Needs a title</span>}
        </div>
      )}
    </form>
  );
}
