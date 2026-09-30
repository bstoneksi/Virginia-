import { Link } from "react-router";
import { api } from "@/api";
import { Avatar, DivisionChip } from "@/components/Badges";
import { Icon } from "@/components/Icon";
import { EmptyState, ErrorState } from "@/components/States";
import { useBootstrap } from "@/lib/bootstrap";
import { todayISO } from "@/lib/dates";
import { useItemChanges } from "@/lib/itemEvents";
import { usePageTitle } from "@/lib/shell";
import { useQuery } from "@/lib/useQuery";
import { isOverdue } from "@shared/types";

export function PeoplePage() {
  usePageTitle("People");
  const { people, division } = useBootstrap();
  const items = useQuery((signal) => api.items.list({}, signal), []);
  useItemChanges(() => void items.reload());

  const today = todayISO();
  const counts = new Map<string, { open: number; overdue: number }>();
  let unassigned = 0;
  for (const item of items.data ?? []) {
    if (!item.ownerInitials) {
      unassigned++;
      continue;
    }
    const entry = counts.get(item.ownerInitials) ?? { open: 0, overdue: 0 };
    entry.open++;
    if (isOverdue(item, today)) entry.overdue++;
    counts.set(item.ownerInitials, entry);
  }
  const sorted = [...people].sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.fullName.localeCompare(b.fullName));

  return (
    <div className="flex flex-col gap-3">
      {items.error && !items.data && <ErrorState error={items.error} onRetry={() => void items.reload(false)} />}
      {sorted.length === 0 ? (
        <EmptyState
          title="No people yet"
          hint="Add your direct reports in Settings → People."
          action={
            <Link to="/settings?tab=people" className="text-sm font-medium text-brand underline">
              Open Settings
            </Link>
          }
        />
      ) : (
        <ul className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {sorted.map((p) => {
            const c = counts.get(p.initials);
            const div = division(p.divisionCode);
            return (
              <li key={p.id} className="border-b border-slate-100 last:border-b-0">
                <Link to={`/people/${encodeURIComponent(p.initials)}`} className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-slate-50">
                  <Avatar initials={p.initials} size="md" title={p.fullName} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {p.fullName}
                      {p.isMe && <span className="ml-1.5 text-xs font-normal text-slate-400">(me)</span>}
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      {p.role && <span>{p.role}</span>}
                      {div && <DivisionChip division={div} />}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {c && c.overdue > 0 && <span className="rounded-full bg-red-100 px-2 font-semibold leading-5 text-red-700">{c.overdue} overdue</span>}
                    <span className={`rounded-full px-2 font-semibold leading-5 ${c?.open ? "bg-slate-100 text-slate-700" : "text-slate-400"}`}>{c?.open ?? 0} open</span>
                    <Icon name="chevronRight" className="h-4 w-4 text-slate-300" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {unassigned > 0 && (
        <p className="text-xs text-slate-500">
          {unassigned} open item{unassigned === 1 ? "" : "s"} {unassigned === 1 ? "has" : "have"} no owner —{" "}
          <Link to="/" className="font-medium text-brand underline">
            triage {unassigned === 1 ? "it" : "them"} on Today
          </Link>
          .
        </p>
      )}
    </div>
  );
}
