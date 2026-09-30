import { useState } from "react";
import type { Division, DivisionKind } from "@shared/types";
import { DIVISION_KINDS } from "@shared/types";
import { api, errorMessage } from "@/api";
import { Button, Field, Select, TextInput, Toggle } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { useBootstrap } from "@/lib/bootstrap";
import { useToast } from "@/lib/toast";

const EMPTY: Division = { code: "", name: "", kind: "brand", parentCode: null, color: "#1B2A49", textColor: "#FFFFFF", sortOrder: 50, archived: false };

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-11 w-12 shrink-0 cursor-pointer rounded-md border border-slate-300 bg-white p-1" aria-label={`${label} picker`} />
        <TextInput value={value} onChange={(e) => onChange(e.target.value)} placeholder="#1B2A49" className="font-mono uppercase" maxLength={7} />
      </div>
    </Field>
  );
}

export function DivisionsSettings() {
  const { allDivisions, reload } = useBootstrap();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ isNew: boolean; form: Division } | null>(null);
  const [busy, setBusy] = useState(false);

  const list = allDivisions.filter((d) => showArchived || !d.archived);
  const setForm = <K extends keyof Division>(key: K, value: Division[K]) => setEditing((prev) => (prev ? { ...prev, form: { ...prev.form, [key]: value } } : prev));

  const save = async () => {
    if (!editing) return;
    const form: Division = { ...editing.form, code: editing.form.code.trim().toUpperCase(), name: editing.form.name.trim(), sortOrder: Number(editing.form.sortOrder) || 0 };
    if (!form.code || form.code.length > 8) {
      toast.error("Code is required (up to 8 characters)");
      return;
    }
    if (!form.name) {
      toast.error("Name is required");
      return;
    }
    if (!/^#[0-9A-F]{6}$/.test(form.color) || !/^#[0-9A-F]{6}$/.test(form.textColor)) {
      toast.error("Colors must be 6-digit hex, e.g. #1B2A49");
      return;
    }
    setBusy(true);
    try {
      if (editing.isNew) await api.divisions.create(form);
      else {
        const { code, ...patch } = form;
        await api.divisions.update(code, patch);
      }
      await reload();
      setEditing(null);
      toast.success(editing.isNew ? `Added ${form.code}` : "Saved");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-500">Brands, functions and the personal bucket. The code is what you write in notes; the color paints the chips.</p>
        <div className="ml-auto flex items-center gap-3">
          <Toggle checked={showArchived} onChange={setShowArchived} label={<span className="text-xs">Show archived</span>} />
          <Button variant="primary" size="sm" onClick={() => setEditing({ isNew: true, form: EMPTY })}>
            <Icon name="plus" className="h-4 w-4" /> Add division
          </Button>
        </div>
      </div>
      <ul className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {list.map((d) => (
          <li key={d.code} className="border-b border-slate-100 last:border-b-0">
            <button type="button" onClick={() => setEditing({ isNew: false, form: { ...d } })} className={`flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 ${d.archived ? "opacity-50" : ""} ${d.parentCode ? "pl-8" : ""}`}>
              <span className="flex h-9 min-w-9 items-center justify-center rounded-md px-1.5 text-xs font-bold" style={{ background: d.color, color: d.textColor }}>
                {d.code}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">
                  {d.name}
                  {d.archived && <span className="ml-1.5 text-xs font-normal text-slate-400">archived</span>}
                </span>
                <span className="text-xs text-slate-500">
                  {d.kind}
                  {d.parentCode && ` · part of ${d.parentCode}`} · order {d.sortOrder}
                </span>
              </span>
              <Icon name="edit" className="h-4 w-4 text-slate-300" />
            </button>
          </li>
        ))}
      </ul>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        variant="center"
        title={editing?.isNew ? "Add division" : `Edit ${editing?.form.code}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        {editing && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-[7rem_1fr] gap-3">
              <Field label="Code">
                <TextInput value={editing.form.code} onChange={(e) => setForm("code", e.target.value.toUpperCase())} disabled={!editing.isNew} maxLength={8} placeholder="HG" className="uppercase" autoFocus={editing.isNew} />
              </Field>
              <Field label="Name">
                <TextInput value={editing.form.name} onChange={(e) => setForm("name", e.target.value)} placeholder="Henderson Glass" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kind">
                <Select value={editing.form.kind} onChange={(e) => setForm("kind", e.target.value as DivisionKind)}>
                  {DIVISION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Parent">
                <Select value={editing.form.parentCode ?? ""} onChange={(e) => setForm("parentCode", e.target.value || null)}>
                  <option value="">— none —</option>
                  {allDivisions
                    .filter((d) => !d.parentCode && d.code !== editing.form.code)
                    .map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.code} · {d.name}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ColorField label="Chip color" value={editing.form.color} onChange={(v) => setForm("color", v)} />
              <ColorField label="Text color" value={editing.form.textColor} onChange={(v) => setForm("textColor", v)} />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">Preview</span>
              <span className="rounded px-2 text-xs font-bold leading-6" style={{ background: editing.form.color, color: editing.form.textColor }}>
                {editing.form.code || "CODE"}
              </span>
            </div>
            <Field label="Sort order" hint="Lower numbers list first.">
              <TextInput type="number" value={editing.form.sortOrder} onChange={(e) => setForm("sortOrder", Number(e.target.value))} />
            </Field>
            {!editing.isNew && <Toggle checked={editing.form.archived} onChange={(v) => setForm("archived", v)} label={<span>Archived (hidden from pickers)</span>} />}
          </div>
        )}
      </Sheet>
    </section>
  );
}
