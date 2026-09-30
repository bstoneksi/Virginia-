import { useState } from "react";
import type { Person } from "@shared/types";
import { api, errorMessage, type PersonInput } from "@/api";
import { Avatar, DivisionChip } from "@/components/Badges";
import { Button, Field, Select, TextInput, Toggle } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { useBootstrap } from "@/lib/bootstrap";
import { useToast } from "@/lib/toast";

const EMPTY: PersonInput = { initials: "", fullName: "", divisionCode: null, email: null, role: null, isMe: false, archived: false };

function toInput(p: Person): PersonInput {
  return { initials: p.initials, fullName: p.fullName, divisionCode: p.divisionCode, email: p.email, role: p.role, isMe: p.isMe, archived: p.archived };
}

export function PeopleSettings() {
  const { allPeople, divisions, division, reload } = useBootstrap();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ id: number | null; form: PersonInput } | null>(null);
  const [busy, setBusy] = useState(false);

  const list = allPeople.filter((p) => showArchived || !p.archived);

  const save = async () => {
    if (!editing) return;
    const form: PersonInput = {
      ...editing.form,
      initials: editing.form.initials.trim().toUpperCase(),
      fullName: editing.form.fullName.trim(),
      email: editing.form.email?.trim() || null,
      role: editing.form.role?.trim() || null,
    };
    if (!/^[A-Z]{2,3}$/.test(form.initials)) {
      toast.error("Initials must be 2–3 letters");
      return;
    }
    if (!form.fullName) {
      toast.error("Full name is required");
      return;
    }
    setBusy(true);
    try {
      if (editing.id === null) await api.people.create(form);
      else await api.people.update(editing.id, form);
      await reload();
      setEditing(null);
      toast.success(editing.id === null ? `Added ${form.fullName}` : "Saved");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const setForm = <K extends keyof PersonInput>(key: K, value: PersonInput[K]) => setEditing((prev) => (prev ? { ...prev, form: { ...prev.form, [key]: value } } : prev));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-500">Direct reports and anyone you assign items to. Archive instead of deleting so history keeps its names.</p>
        <div className="ml-auto flex items-center gap-3">
          <Toggle checked={showArchived} onChange={setShowArchived} label={<span className="text-xs">Show archived</span>} />
          <Button variant="primary" size="sm" onClick={() => setEditing({ id: null, form: EMPTY })}>
            <Icon name="plus" className="h-4 w-4" /> Add person
          </Button>
        </div>
      </div>
      <ul className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {list.map((p) => (
          <li key={p.id} className="border-b border-slate-100 last:border-b-0">
            <button
              type="button"
              aria-label={`Edit ${p.fullName}`}
              onClick={() => setEditing({ id: p.id, form: toInput(p) })}
              className={`flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 ${p.archived ? "opacity-50" : ""}`}
            >
              <Avatar initials={p.initials} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">
                  {p.fullName}
                  {p.isMe && <span className="ml-1.5 rounded bg-brand/10 px-1 text-[10px] font-semibold text-brand">ME</span>}
                  {p.archived && <span className="ml-1.5 text-xs font-normal text-slate-400">archived</span>}
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  {p.role && <span>{p.role}</span>}
                  {p.divisionCode && <DivisionChip division={division(p.divisionCode)} code={p.divisionCode} />}
                  {p.email && <span className="truncate">{p.email}</span>}
                </span>
              </span>
              <Icon name="edit" className="h-4 w-4 text-slate-300" />
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No people yet.</li>}
      </ul>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        variant="center"
        title={editing?.id === null ? "Add person" : "Edit person"}
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
            <div className="grid grid-cols-[6rem_1fr] gap-3">
              <Field label="Initials">
                <TextInput value={editing.form.initials} onChange={(e) => setForm("initials", e.target.value.toUpperCase())} maxLength={3} placeholder="VM" autoFocus={editing.id === null} className="uppercase" />
              </Field>
              <Field label="Full name">
                <TextInput value={editing.form.fullName} onChange={(e) => setForm("fullName", e.target.value)} placeholder="Vincent Moynihan" />
              </Field>
            </div>
            <Field label="Division">
              <Select value={editing.form.divisionCode ?? ""} onChange={(e) => setForm("divisionCode", e.target.value || null)}>
                <option value="">— none —</option>
                {divisions.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code} · {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Email">
                <TextInput type="email" value={editing.form.email ?? ""} onChange={(e) => setForm("email", e.target.value || null)} />
              </Field>
              <Field label="Role">
                <TextInput value={editing.form.role ?? ""} onChange={(e) => setForm("role", e.target.value || null)} placeholder="GM, Henderson Glass" />
              </Field>
            </div>
            <Toggle checked={editing.form.isMe} onChange={(v) => setForm("isMe", v)} label={<span>This is me (owner of untagged actions)</span>} />
            {editing.id !== null && <Toggle checked={editing.form.archived} onChange={(v) => setForm("archived", v)} label={<span>Archived (hidden from pickers)</span>} />}
          </div>
        )}
      </Sheet>
    </section>
  );
}
