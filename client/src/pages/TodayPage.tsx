import { Link } from "react-router";
import type { Item } from "@shared/types";
import { api } from "@/api";
import { Icon } from "@/components/Icon";
import { ItemList } from "@/components/ItemCard";
import { QuickAdd } from "@/components/QuickAdd";
import { EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/States";
import { useBootstrap } from "@/lib/bootstrap";
import { TZ } from "@/lib/dates";
import { useItemDrawer } from "@/lib/drawer";
import { useItemChanges } from "@/lib/itemEvents";
import { usePageTitle } from "@/lib/shell";
import { useQuery } from "@/lib/useQuery";

function Section({ title, items, tone = "default", hint, onOpen }: { title: string; items: Item[]; tone?: "default" | "danger"; hint?: string; onOpen: (item: Item) => void }) {
  if (items.length === 0) return null;
  return (
    <section>
      <SectionHeader title={title} count={items.length} right={hint ? <span className="text-xs text-slate-400">{hint}</span> : undefined} />
      <div className={tone === "danger" ? "rounded-lg ring-1 ring-red-200" : ""}>
        <ItemList items={items} onOpen={onOpen} showStatus />
      </div>
    </section>
  );
}

export function TodayPage() {
  usePageTitle("Today");
  const { me } = useBootstrap();
  const { openItem } = useItemDrawer();
  const today = useQuery((signal) => api.today(signal), []);
  useItemChanges(() => void today.reload());

  const open = (item: Item) => openItem(item.id);
  const dateLine = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).format(new Date());
  const data = today.data;
  const total = data ? data.overdue.length + data.dueSoon.length + data.highPriority.length + data.unowned.length : 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-sm text-slate-500">{dateLine}</p>
        <QuickAdd className="mt-2" placeholder={`Quick add for ${me?.initials ?? "me"} — "Send updated glass quote — HG due 10/15"`} onCreated={() => void today.reload()} />
      </div>

      {data && data.pendingCaptures > 0 && (
        <Link to="/capture" className="flex min-h-12 items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm text-amber-900 hover:bg-amber-100">
          <Icon name="inbox" className="h-5 w-5 shrink-0" />
          <span className="flex-1">
            <strong>{data.pendingCaptures}</strong> capture{data.pendingCaptures === 1 ? "" : "s"} waiting for review
          </span>
          <Icon name="chevronRight" className="h-4 w-4" />
        </Link>
      )}

      {today.loading && !data && <LoadingState />}
      {today.error && !data && <ErrorState error={today.error} onRetry={() => void today.reload(false)} />}

      {data && (
        <>
          <Section title="Overdue" items={data.overdue} tone="danger" onOpen={open} />
          <Section title="Due this week" items={data.dueSoon} onOpen={open} />
          <Section title="High priority" items={data.highPriority} onOpen={open} />
          <Section title="Needs an owner" items={data.unowned} hint="Assign a person or division" onOpen={open} />
          {total === 0 && (
            <EmptyState
              title="Nothing needs you today"
              hint="No overdue, due-soon, high-priority or unowned items. Add one above or review the board."
              action={
                <Link to="/board" className="text-sm font-medium text-brand underline">
                  Open the board
                </Link>
              }
            />
          )}
        </>
      )}
    </div>
  );
}
