import type { Category, ImportRow, ItemDraft, Priority, Status } from "@shared/types";
import { CATEGORIES, CATEGORY_LABELS, PRIORITIES, STATUSES } from "@shared/types";
import { Chip } from "@/components/Badges";
import { Select, TextInput } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { useBootstrap } from "@/lib/bootstrap";

interface ImportRowEditorProps {
  row: ImportRow;
  onChange: (next: ImportRow) => void;
}

/** One import row as an editable card (fits 375 px without horizontal scroll). */
export function ImportRowEditor({ row, onChange }: ImportRowEditorProps) {
  const { people, divisions } = useBootstrap();
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) => onChange({ ...row, draft: { ...row.draft, [key]: value } });
  const d = row.draft;
  const small = "!min-h-10 text-xs";

  return (
    <li className={`flex flex-col gap-2 rounded-xl border bg-white p-3 ${row.include ? (row.warnings.length ? "border-amber-300" : "border-slate-200") : "border-slate-200 opacity-60"}`}>
      <div className="flex items-center gap-2">
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={row.include} onChange={(e) => onChange({ ...row, include: e.target.checked })} className="h-5 w-5 accent-brand" aria-label="Include row" />
          <span className="font-medium text-slate-800">{row.table}</span>
        </label>
        <span className="ml-auto text-[11px] text-slate-400">
          {row.sheet} · row {row.rowNumber}
        </span>
      </div>
      <TextInput value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="Title" aria-label="Title" className={small} disabled={!row.include} />
      {d.note && d.note !== d.title && <p className="line-clamp-3 text-xs text-slate-500">{d.note}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Select value={d.category} onChange={(e) => set("category", e.target.value as Category)} aria-label="Category" className={small} disabled={!row.include}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c} · {CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
        <Select value={d.divisionCode ?? ""} onChange={(e) => set("divisionCode", e.target.value || null)} aria-label="Division" className={small} disabled={!row.include}>
          <option value="">— division —</option>
          {divisions.map((dv) => (
            <option key={dv.code} value={dv.code}>
              {dv.code} · {dv.name}
            </option>
          ))}
        </Select>
        <Select value={d.ownerInitials ?? ""} onChange={(e) => set("ownerInitials", e.target.value || null)} aria-label="Owner" className={small} disabled={!row.include}>
          <option value="">— owner —</option>
          {people.map((p) => (
            <option key={p.initials} value={p.initials}>
              {p.initials} · {p.fullName}
            </option>
          ))}
        </Select>
        <Select value={d.priority} onChange={(e) => set("priority", e.target.value as Priority)} aria-label="Priority" className={small} disabled={!row.include}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Select value={d.status} onChange={(e) => set("status", e.target.value as Status)} aria-label="Status" className={small} disabled={!row.include}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <TextInput type="date" value={d.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} aria-label="Due date" className={small} disabled={!row.include} />
      </div>
      {row.warnings.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-amber-800">
          {row.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1">
              <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
            </li>
          ))}
        </ul>
      )}
      {(row.raw.Division || row.raw["Owner/Target"] || row.raw.WHO) && (
        <div className="flex flex-wrap gap-1 text-[11px] text-slate-400">
          <span>Source:</span>
          {row.raw.Division && <Chip>{row.raw.Division}</Chip>}
          {(row.raw["Owner/Target"] || row.raw.WHO) && <Chip>{row.raw["Owner/Target"] || row.raw.WHO}</Chip>}
        </div>
      )}
    </li>
  );
}
