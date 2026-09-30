import { useState } from "react";
import type { ItemEvent } from "@shared/types";
import { formatDateTime } from "@/lib/dates";
import { Button, TextArea } from "./Field";
import { Icon, type IconName } from "./Icon";

const EVENT_ICON: Record<ItemEvent["type"], IconName> = {
  created: "plus",
  status: "refresh",
  edit: "edit",
  comment: "comment",
};

function describe(event: ItemEvent): string {
  const data = event.data;
  switch (event.type) {
    case "created":
      return "Created";
    case "status": {
      const from = typeof data.from === "string" ? data.from : "?";
      const to = typeof data.to === "string" ? data.to : "?";
      return `${from} → ${to}`;
    }
    case "edit": {
      const changes = data.changes;
      if (changes && typeof changes === "object") {
        const keys = Object.keys(changes as Record<string, unknown>);
        if (keys.length) return `Edited ${keys.join(", ")}`;
      }
      const keys = Object.keys(data).filter((k) => k !== "changes");
      return keys.length ? `Edited ${keys.join(", ")}` : "Edited";
    }
    case "comment":
      return typeof data.text === "string" ? data.text : "";
  }
}

export function ItemHistory({ events, onComment }: { events: ItemEvent[]; onComment: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const sorted = [...events].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    setPosting(true);
    try {
      await onComment(value);
      setText("");
    } finally {
      setPosting(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Comments & history</h3>
      <div className="flex flex-col gap-2">
        <TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Add a comment…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
        />
        <div className="flex justify-end">
          <Button size="sm" variant="subtle" onClick={() => void submit()} disabled={posting || !text.trim()}>
            {posting ? "Posting…" : "Post comment"}
          </Button>
        </div>
      </div>
      <ol className="flex flex-col gap-2">
        {sorted.map((event) => (
          <li key={event.id} className="flex gap-2 text-sm">
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${event.type === "comment" ? "bg-brand/10 text-brand" : "bg-slate-100 text-slate-500"}`}>
              <Icon name={EVENT_ICON[event.type]} className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`break-words ${event.type === "comment" ? "whitespace-pre-wrap text-slate-900" : "text-slate-600"}`}>{describe(event)}</p>
              <p className="text-[11px] text-slate-400">{formatDateTime(event.createdAt)}</p>
            </div>
          </li>
        ))}
        {sorted.length === 0 && <li className="text-xs text-slate-400">No history yet.</li>}
      </ol>
    </section>
  );
}
