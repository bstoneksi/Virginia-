import { useState, type FormEvent } from "react";
import type { Initiative, InitiativeStatus } from "@shared/types";
import { INITIATIVE_STATUSES } from "@shared/types";
import { api, errorMessage } from "@/api";
import { Button, Select, TextInput } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { useBootstrap } from "@/lib/bootstrap";
import { useToast } from "@/lib/toast";

const STATUS_CLASS: Record<InitiativeStatus, string> = {
  Active: "bg-emerald-50 text-emerald-800",
  "On Hold": "bg-amber-50 text-amber-800",
  Complete: "bg-slate-100 text-slate-600",
};

export function InitiativesSettings() {
  const { initiatives, reload } = useBootstrap();
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await api.initiatives.create({ name: trimmed });
      await reload();
      setName("");
      toast.success(`Added ${trimmed}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (i: Initiative, status: InitiativeStatus) => {
    try {
      await api.initiatives.update(i.id, { status });
      await reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const rename = async () => {
    if (!renaming) return;
    const trimmed = renaming.name.trim();
    if (!trimmed) return;
    try {
      await api.initiatives.update(renaming.id, { name: trimmed });
      await reload();
      setRenaming(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-slate-500">Optional roll-ups for items (“Initiative: Name” in notes). BAU is the default bucket.</p>
      <form onSubmit={(e) => void add(e)} className="flex gap-2">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="New initiative name" aria-label="New initiative" />
        <Button type="submit" variant="primary" disabled={busy || !name.trim()} className="shrink-0">
          <Icon name="plus" className="h-4 w-4" /> Add
        </Button>
      </form>
      <ul className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {initiatives.map((i) => (
          <li key={i.id} className="flex min-h-14 items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0">
            {renaming?.id === i.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void rename();
                }}
                className="flex min-w-0 flex-1 gap-2"
              >
                <TextInput value={renaming.name} onChange={(e) => setRenaming({ id: i.id, name: e.target.value })} autoFocus />
                <Button type="submit" size="sm" variant="primary">
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <button type="button" onClick={() => setRenaming({ id: i.id, name: i.name })} className="min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-900 hover:underline" title="Rename">
                {i.name}
              </button>
            )}
            <Select value={i.status} onChange={(e) => void setStatus(i, e.target.value as InitiativeStatus)} aria-label={`Status of ${i.name}`} className={`!w-auto !min-h-9 border-0 text-xs font-semibold ${STATUS_CLASS[i.status]}`}>
              {INITIATIVE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </li>
        ))}
        {initiatives.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No initiatives yet.</li>}
      </ul>
    </section>
  );
}
