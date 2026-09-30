import type { Item, ItemDraft } from "@shared/types";
import { emptyDraft } from "@shared/types";

/** Convert a stored item into the editable draft shape (initiativeId → initiativeName). */
export function itemToDraft(item: Item, initiativeName: (id: number | null) => string | null): ItemDraft {
  return emptyDraft({
    category: item.category,
    title: item.title,
    note: item.note,
    divisionCode: item.divisionCode,
    ownerInitials: item.ownerInitials,
    initiativeName: initiativeName(item.initiativeId),
    priority: item.priority,
    status: item.status,
    dueDate: item.dueDate,
    isPersonal: item.isPersonal,
    context: item.context,
  });
}

const DRAFT_KEYS = Object.keys(emptyDraft()) as (keyof ItemDraft)[];

/** Only the fields that differ between two drafts (for PATCH). */
export function draftDiff(base: ItemDraft, next: ItemDraft): Partial<ItemDraft> {
  const out: Partial<ItemDraft> = {};
  for (const key of DRAFT_KEYS) {
    if (base[key] !== next[key]) {
      (out as Record<string, unknown>)[key] = next[key];
    }
  }
  return out;
}

export function isDraftDirty(base: ItemDraft, next: ItemDraft): boolean {
  return Object.keys(draftDiff(base, next)).length > 0;
}

/** Client-side validation mirroring the server rules. Returns an error message or null. */
export function validateDraft(draft: ItemDraft): string | null {
  const title = draft.title.trim();
  if (!title) return "Title is required";
  if (title.length > 140) return "Title must be 140 characters or fewer";
  if (draft.category === "NB" && !draft.ownerInitials && !draft.divisionCode) return "New Business needs a target (person or division)";
  return null;
}

/** Trim strings and turn empty strings into null where the API expects null. */
export function normalizeDraft(draft: ItemDraft): ItemDraft {
  const clean = (v: string | null): string | null => {
    const t = v?.trim() ?? "";
    return t ? t : null;
  };
  return {
    ...draft,
    title: draft.title.trim(),
    note: draft.note.trim(),
    divisionCode: draft.isPersonal ? null : clean(draft.divisionCode),
    ownerInitials: clean(draft.ownerInitials),
    initiativeName: clean(draft.initiativeName),
    dueDate: clean(draft.dueDate),
    context: clean(draft.context),
  };
}
