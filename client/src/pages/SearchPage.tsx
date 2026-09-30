import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { SearchResult } from "@shared/types";
import { api } from "@/api";
import { Chip } from "@/components/Badges";
import { TextInput } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { ItemList } from "@/components/ItemCard";
import { EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/States";
import { formatRelative } from "@/lib/dates";
import { useItemDrawer } from "@/lib/drawer";
import { useItemChanges } from "@/lib/itemEvents";
import { usePageTitle } from "@/lib/shell";
import { useQuery } from "@/lib/useQuery";
import { KIND_ICON } from "./CapturePage";

export function SearchPage() {
  usePageTitle("Search");
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  const { openItem } = useItemDrawer();

  useEffect(() => {
    if (text === q) return;
    const id = window.setTimeout(() => {
      const next = new URLSearchParams(params);
      if (text.trim()) next.set("q", text.trim());
      else next.delete("q");
      setParams(next, { replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [text, q, params, setParams]);

  const active = q.trim().length >= 2;
  const results = useQuery<SearchResult | null>((signal) => (active ? api.search(q.trim(), signal) : Promise.resolve(null)), [q, active]);
  useItemChanges(() => {
    if (active) void results.reload();
  });

  const data = results.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <TextInput type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search items and captures…" autoFocus aria-label="Search" className="pl-9" enterKeyHint="search" />
      </div>
      {!active && <EmptyState compact title="Type at least two characters" hint="Searches titles, notes, context and captured text." />}
      {active && results.loading && !data && <LoadingState label="Searching…" />}
      {active && results.error && !data && <ErrorState error={results.error} onRetry={() => void results.reload(false)} />}
      {active && data && (
        <>
          <section>
            <SectionHeader title="Items" count={data.items.length} />
            <ItemList items={data.items} onOpen={(item) => openItem(item.id)} showStatus empty={<p className="text-sm text-slate-500">No items match “{q}”.</p>} />
          </section>
          <section>
            <SectionHeader title="Captures" count={data.captures.length} />
            {data.captures.length === 0 ? (
              <p className="text-sm text-slate-500">No captures match.</p>
            ) : (
              <ul className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                {data.captures.map((c) => (
                  <li key={c.id} className="border-b border-slate-100 last:border-b-0">
                    <Link to={`/capture/${c.id}`} className="flex min-h-12 items-center gap-3 px-3 py-2 hover:bg-slate-50">
                      <Icon name={KIND_ICON[c.kind]} className="h-4 w-4 shrink-0 text-slate-500" />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{c.title || c.context || `${c.kind} capture`}</span>
                      <Chip>{c.status}</Chip>
                      <span className="text-xs text-slate-400">{formatRelative(c.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
