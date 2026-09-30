import { useState } from "react";
import type { Agenda, Item, ItemDraft, Status } from "@shared/types";
import { CATEGORY_LABELS, STATUSES, STATUS_COLORS } from "@shared/types";
import { api, errorMessage } from "@/api";
import { useItemDrawer } from "@/lib/drawer";
import { formatDateTime } from "@/lib/dates";
import { emitItemChange, useItemChanges } from "@/lib/itemEvents";
import { useToast } from "@/lib/toast";
import { useQuery } from "@/lib/useQuery";
import { CategoryBadge } from "./Badges";
import { Button, TextArea, Toggle } from "./Field";
import { Icon } from "./Icon";
import { ItemCard } from "./ItemCard";
import { QuickAdd } from "./QuickAdd";
import { Sheet } from "./Sheet";
import { EmptyState, ErrorState, LoadingState } from "./States";

interface AgendaViewProps {
  subject: { type: "person" | "division"; key: string };
  quickAddDefaults: Partial<ItemDraft>;
}

function StatusSelect({ item, onChanged }: { item: Item; onChanged: (item: Item) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const c = STATUS_COLORS[item.status];
  return (
    <select
      value={item.status}
      disabled={busy}
      aria-label={`Status of ${item.title}`}
      onChange={async (e) => {
        const status = e.target.value as Status;
        setBusy(true);
        try {
          const updated = await api.items.update(item.id, { status });
          emitItemChange({ type: "updated", item: updated });
          onChanged(updated);
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
      className="no-print min-h-11 max-w-[7.5rem] rounded-md border-0 px-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand/30"
      style={{ background: c.bg, color: c.fg }}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

export function AgendaView({ subject, quickAddDefaults }: AgendaViewProps) {
  const toast = useToast();
  const { openItem } = useItemDrawer();
  const [includeDone, setIncludeDone] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const agenda = useQuery<Agenda>(
    () => (subject.type === "person" ? api.agenda.person(subject.key, includeDone) : api.agenda.division(subject.key, includeDone)),
    [subject.type, subject.key, includeDone],
  );
  useItemChanges(() => void agenda.reload());

  const copy = async () => {
    if (!agenda.data) return;
    try {
      await navigator.clipboard.writeText(agenda.data.markdown);
      toast.success("Agenda copied as Markdown");
    } catch {
      setFallback(agenda.data.markdown);
    }
  };

  const data = agenda.data;
  const groups = data?.groups.filter((g) => g.active.length + g.parked.length + g.done.length > 0) ?? [];
  const total = groups.reduce((n, g) => n + g.active.length + g.parked.length + g.done.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-2">
        <QuickAdd defaults={quickAddDefaults} placeholder={`Quick add for ${subject.key} — "Q: When does the new quote template ship?"`} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void copy()} disabled={!data}>
            <Icon name="copy" className="h-4 w-4" /> Copy agenda
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()} disabled={!data}>
            <Icon name="print" className="h-4 w-4" /> Print
          </Button>
          <div className="ml-auto">
            <Toggle checked={includeDone} onChange={setIncludeDone} label={<span className="text-xs">Show done</span>} />
          </div>
        </div>
      </div>

      {agenda.loading && !data && <LoadingState label="Building agenda…" />}
      {agenda.error && !data && <ErrorState error={agenda.error} onRetry={() => void agenda.reload(false)} />}

      {data && total === 0 && <EmptyState title="Nothing on this agenda" hint="Quick-add an item above, or capture meeting notes and accept the proposals." />}

      {data &&
        groups.map((group) => (
          <section key={group.category} className="print-block">
            <h2 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <CategoryBadge category={group.category} />
              {CATEGORY_LABELS[group.category]}
              <span className="text-xs font-normal text-slate-400">{group.active.length + group.parked.length + group.done.length}</span>
            </h2>
            <div className="rounded-lg border border-slate-200 bg-white px-3">
              {group.active.map((item) => (
                <ItemCard key={item.id} item={item} onOpen={(i) => openItem(i.id)} trailing={<StatusSelect item={item} onChanged={() => void agenda.reload()} />} />
              ))}
              {group.parked.map((item) => (
                <ItemCard key={item.id} item={item} muted onOpen={(i) => openItem(i.id)} trailing={<StatusSelect item={item} onChanged={() => void agenda.reload()} />} />
              ))}
              {group.done.map((item) => (
                <ItemCard key={item.id} item={item} muted showStatus onOpen={(i) => openItem(i.id)} />
              ))}
            </div>
          </section>
        ))}

      {data && <p className="text-[11px] text-slate-400">Generated {formatDateTime(data.generatedAt)}</p>}

      <Sheet open={fallback !== null} onClose={() => setFallback(null)} variant="center" title="Copy agenda">
        <p className="mb-2 text-sm text-slate-600">Clipboard access was blocked — select the text below and copy it.</p>
        <TextArea readOnly value={fallback ?? ""} rows={14} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
      </Sheet>
    </div>
  );
}
