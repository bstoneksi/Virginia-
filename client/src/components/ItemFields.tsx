import type { Category, ItemDraft, Priority, Status } from "@shared/types";
import { CATEGORIES, CATEGORY_COLORS, CATEGORY_LABELS, PRIORITIES, PRIORITY_COLORS, STATUSES } from "@shared/types";
import { useBootstrap } from "@/lib/bootstrap";
import { Field, Segmented, Select, TextArea, TextInput, Toggle } from "./Field";

interface ItemFieldsProps {
  draft: ItemDraft;
  onChange: (next: ItemDraft) => void;
  /** Show the status control (hidden for quick proposal edits where status is implied). */
  showStatus?: boolean;
  compact?: boolean;
  autoFocusTitle?: boolean;
  idPrefix?: string;
}

/** Editable form for every ItemDraft field. Shared by the drawer, the new-item dialog and review cards. */
export function ItemFields({ draft, onChange, showStatus = true, compact = false, autoFocusTitle = false, idPrefix = "item" }: ItemFieldsProps) {
  const { people, divisions, initiatives } = useBootstrap();
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) => onChange({ ...draft, [key]: value });
  const titleLen = draft.title.length;

  return (
    <div className={`flex flex-col ${compact ? "gap-2.5" : "gap-3"}`}>
      <Segmented<Category>
        size={compact ? "sm" : "md"}
        value={draft.category}
        onChange={(v) => set("category", v)}
        options={CATEGORIES.map((c) => ({
          value: c,
          label: c,
          title: CATEGORY_LABELS[c],
          activeStyle: { background: CATEGORY_COLORS[c].bg, color: CATEGORY_COLORS[c].fg },
        }))}
      />

      <Field
        label={
          <span className="flex justify-between">
            <span>Title</span>
            {titleLen > 110 && <span className={titleLen > 140 ? "text-red-600" : "text-slate-400"}>{titleLen}/140</span>}
          </span>
        }
      >
        <TextInput
          id={`${idPrefix}-title`}
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          maxLength={160}
          autoFocus={autoFocusTitle}
          placeholder="Short imperative headline"
          autoComplete="off"
        />
      </Field>

      <Field label="Note">
        <TextArea id={`${idPrefix}-note`} value={draft.note} onChange={(e) => set("note", e.target.value)} rows={compact ? 2 : 3} placeholder="Detail, who said what, links…" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={draft.category === "NB" ? "Target" : "Owner"}>
          <Select value={draft.ownerInitials ?? ""} onChange={(e) => set("ownerInitials", e.target.value || null)}>
            <option value="">{draft.category === "A" ? "— me —" : "— none —"}</option>
            {people.map((p) => (
              <option key={p.initials} value={p.initials}>
                {p.initials} · {p.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Division">
          <Select value={draft.isPersonal ? "" : (draft.divisionCode ?? "")} onChange={(e) => set("divisionCode", e.target.value || null)} disabled={draft.isPersonal}>
            <option value="">— none —</option>
            {divisions
              .filter((d) => d.kind !== "personal")
              .map((d) => (
                <option key={d.code} value={d.code}>
                  {d.code} · {d.name}
                </option>
              ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority">
          <Segmented<Priority>
            size="sm"
            value={draft.priority}
            onChange={(v) => set("priority", v)}
            options={PRIORITIES.map((p) => ({ value: p, label: p, activeStyle: { background: PRIORITY_COLORS[p].bg, color: PRIORITY_COLORS[p].fg } }))}
          />
        </Field>
        <Field label="Due">
          <div className="flex items-center gap-1">
            <TextInput type="date" value={draft.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} className="min-w-0" />
            {draft.dueDate && (
              <button type="button" onClick={() => set("dueDate", null)} className="min-h-11 shrink-0 px-2 text-xs text-slate-500 hover:text-slate-800">
                Clear
              </button>
            )}
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {showStatus && (
          <Field label="Status">
            <Select value={draft.status} onChange={(e) => set("status", e.target.value as Status)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Initiative">
          <TextInput
            list={`${idPrefix}-initiatives`}
            value={draft.initiativeName ?? ""}
            onChange={(e) => set("initiativeName", e.target.value || null)}
            placeholder="BAU"
            autoComplete="off"
          />
          <datalist id={`${idPrefix}-initiatives`}>
            {initiatives.map((i) => (
              <option key={i.id} value={i.name} />
            ))}
          </datalist>
        </Field>
      </div>

      <Field label="Context">
        <TextInput value={draft.context ?? ""} onChange={(e) => set("context", e.target.value || null)} placeholder='e.g. "1:1 with VM 9/30"' autoComplete="off" />
      </Field>

      <Toggle
        checked={draft.isPersonal}
        onChange={(v) => onChange({ ...draft, isPersonal: v, divisionCode: v ? null : draft.divisionCode })}
        label={<span>Personal to-do (PTD)</span>}
      />
    </div>
  );
}
