import { useState } from "react";
import type { Brief, BriefKind } from "@shared/types";
import { api, errorMessage } from "@/api";
import { Chip } from "@/components/Badges";
import { Button, Field, Select, TextArea, TextInput } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useConfirm } from "@/lib/confirm";
import { formatDateTime } from "@/lib/dates";
import { Markdown } from "@/lib/markdown";
import { usePageTitle } from "@/lib/shell";
import { useToast } from "@/lib/toast";
import { useQuery } from "@/lib/useQuery";

const KIND_LABEL: Record<BriefKind, string> = { email_digest: "Email digest", daily: "Daily brief", other: "Note" };

function BriefCard({ brief, onDelete }: { brief: Brief; onDelete: (brief: Brief) => void }) {
  const [expanded, setExpanded] = useState(false);
  const long = brief.bodyMd.length > 900;
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <header className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-base font-semibold text-slate-900">{brief.title}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <Chip>{KIND_LABEL[brief.kind]}</Chip>
            <span>{formatDateTime(brief.createdAt)}</span>
          </p>
        </div>
        <button type="button" onClick={() => onDelete(brief)} className="-mr-2 -mt-1 flex h-11 w-11 items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete brief">
          <Icon name="trash" className="h-4 w-4" />
        </button>
      </header>
      <div className={`relative ${long && !expanded ? "max-h-64 overflow-hidden" : ""}`}>
        <Markdown source={brief.bodyMd} />
        {long && !expanded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white" />}
      </div>
      {long && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 min-h-9 text-sm font-medium text-brand underline">
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </article>
  );
}

export function BriefsPage() {
  usePageTitle("Briefs");
  const toast = useToast();
  const confirm = useConfirm();
  const briefs = useQuery(() => api.briefs.list(50), []);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<BriefKind>("other");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const remove = async (brief: Brief) => {
    const ok = await confirm({ title: `Delete “${brief.title}”?`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.briefs.remove(brief.id);
      briefs.setData((prev) => prev?.filter((b) => b.id !== brief.id));
      toast.success("Brief deleted");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const create = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error("Title and body are required");
      return;
    }
    setBusy(true);
    try {
      await api.briefs.create({ kind, title: title.trim(), bodyMd: body });
      setAdding(false);
      setTitle("");
      setBody("");
      await briefs.reload();
      toast.success("Brief added");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sorted = [...(briefs.data ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">Summaries dropped in by the email-digest routine (via the MCP connector) and your own notes.</p>
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)} className="shrink-0">
          <Icon name="plus" className="h-4 w-4" /> Note
        </Button>
      </div>
      {briefs.loading && !briefs.data && <LoadingState />}
      {briefs.error && !briefs.data && <ErrorState error={briefs.error} onRetry={() => void briefs.reload(false)} />}
      {briefs.data && sorted.length === 0 && <EmptyState title="No briefs yet" hint="Once the Virginia connector is set up, the email digest will appear here every couple of hours." />}
      {sorted.map((b) => (
        <BriefCard key={b.id} brief={b} onDelete={(x) => void remove(x)} />
      ))}

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        variant="center"
        title="New brief"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void create()} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Title">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </Field>
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as BriefKind)}>
              <option value="other">Note</option>
              <option value="daily">Daily brief</option>
              <option value="email_digest">Email digest</option>
            </Select>
          </Field>
          <Field label="Body (Markdown)">
            <TextArea value={body} onChange={(e) => setBody(e.target.value)} rows={10} placeholder={"## Heading\n- bullet with **bold**\n- [link](https://…)"} />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}
