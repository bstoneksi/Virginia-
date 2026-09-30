import { useState } from "react";
import type { Item } from "@shared/types";
import { STATUSES } from "@shared/types";
import { api } from "@/api";
import { ItemList } from "@/components/ItemCard";
import { QuickAdd } from "@/components/QuickAdd";
import { EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/States";
import { addDays, isoDateInTZ, todayISO } from "@/lib/dates";
import { useItemDrawer } from "@/lib/drawer";
import { applyItemChange, useItemChanges } from "@/lib/itemEvents";
import { usePageTitle } from "@/lib/shell";
import { useQuery } from "@/lib/useQuery";

export function PersonalPage() {
  usePageTitle("Personal");
  const { openItem } = useItemDrawer();
  const [showAllDone, setShowAllDone] = useState(false);
  const items = useQuery((signal) => api.items.list({ personal: true, includeDone: true }, signal), []);
  useItemChanges((change) => {
    if (change.type !== "deleted" && !change.item.isPersonal) {
      items.setData((prev) => (prev ? prev.filter((i) => i.id !== change.item.id) : prev));
      return;
    }
    items.setData((prev) => (prev ? applyItemChange(prev, change) : prev));
  });

  const open = (item: Item) => openItem(item.id);
  const list = items.data ?? [];
  const cutoff = addDays(todayISO(), -30);
  const done = list.filter((i) => i.status === "Done");
  const doneVisible = showAllDone ? done : done.filter((i) => isoDateInTZ(i.completedAt ?? i.updatedAt) >= cutoff);

  return (
    <div className="flex flex-col gap-5">
      <QuickAdd defaults={{ isPersonal: true }} placeholder='Quick add a personal to-do — "Renew passport by 11/1"' />
      {items.loading && !items.data && <LoadingState />}
      {items.error && !items.data && <ErrorState error={items.error} onRetry={() => void items.reload(false)} />}
      {items.data && list.length === 0 && <EmptyState title="No personal to-dos" hint='Add one above, or put PTD on a tagged capture line — "A: PTD Renew passport by 11/1".' />}
      {STATUSES.map((status) => {
        const group = status === "Done" ? doneVisible : list.filter((i) => i.status === status);
        if (group.length === 0 && !(status === "Done" && done.length > 0)) return null;
        return (
          <section key={status}>
            <SectionHeader
              title={status}
              count={status === "Done" ? done.length : group.length}
              right={
                status === "Done" && done.length !== doneVisible.length + (showAllDone ? 0 : 0) && done.length > doneVisible.length ? (
                  <button type="button" onClick={() => setShowAllDone(true)} className="min-h-11 px-2 text-xs font-medium text-brand underline">
                    Show all
                  </button>
                ) : status === "Done" && showAllDone ? (
                  <button type="button" onClick={() => setShowAllDone(false)} className="min-h-11 px-2 text-xs font-medium text-brand underline">
                    Last 30 days
                  </button>
                ) : undefined
              }
            />
            <ItemList items={group} onOpen={open} empty={<p className="text-xs text-slate-400">Nothing completed in the last 30 days.</p>} />
          </section>
        );
      })}
    </div>
  );
}
