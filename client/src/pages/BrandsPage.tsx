import { Fragment } from "react";
import { Link } from "react-router";
import type { Division } from "@shared/types";
import { api } from "@/api";
import { Icon } from "@/components/Icon";
import { EmptyState, ErrorState, SectionHeader } from "@/components/States";
import { useBootstrap } from "@/lib/bootstrap";
import { useItemChanges } from "@/lib/itemEvents";
import { usePageTitle } from "@/lib/shell";
import { useQuery } from "@/lib/useQuery";

function DivisionRow({ division, count, child = false }: { division: Division; count: number; child?: boolean }) {
  return (
    <li className="border-b border-slate-100 last:border-b-0">
      <Link to={`/brands/${encodeURIComponent(division.code)}`} className={`flex min-h-14 items-center gap-3 py-2 pr-3 hover:bg-slate-50 ${child ? "pl-8" : "pl-3"}`}>
        <span className="flex h-9 min-w-9 items-center justify-center rounded-md px-1.5 text-xs font-bold" style={{ background: division.color, color: division.textColor }}>
          {division.code}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{division.name}</span>
        <span className={`rounded-full px-2 text-xs font-semibold leading-5 ${count ? "bg-slate-100 text-slate-700" : "text-slate-400"}`}>{count} open</span>
        <Icon name="chevronRight" className="h-4 w-4 text-slate-300" />
      </Link>
    </li>
  );
}

export function BrandsPage() {
  usePageTitle("Brands");
  const { divisions } = useBootstrap();
  const items = useQuery((signal) => api.items.list({}, signal), []);
  useItemChanges(() => void items.reload());

  const counts = new Map<string, number>();
  for (const item of items.data ?? []) {
    if (item.divisionCode) counts.set(item.divisionCode, (counts.get(item.divisionCode) ?? 0) + 1);
  }
  const brands = divisions.filter((d) => d.kind === "brand");
  const functions = divisions.filter((d) => d.kind === "function");
  const topBrands = brands.filter((d) => !d.parentCode);
  const childrenOf = (code: string) => brands.filter((d) => d.parentCode === code);
  const rollup = (d: Division) => (counts.get(d.code) ?? 0) + childrenOf(d.code).reduce((n, c) => n + (counts.get(c.code) ?? 0), 0);

  if (divisions.length === 0) {
    return <EmptyState title="No divisions yet" hint="Add brands and functions in Settings → Divisions." />;
  }

  return (
    <div className="flex flex-col gap-5">
      {items.error && !items.data && <ErrorState error={items.error} onRetry={() => void items.reload(false)} />}
      <section>
        <SectionHeader title="Brands" />
        <ul className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {topBrands.map((d) => (
            <Fragment key={d.code}>
              <DivisionRow division={d} count={rollup(d)} />
              {childrenOf(d.code).map((c) => (
                <DivisionRow key={c.code} division={c} count={counts.get(c.code) ?? 0} child />
              ))}
            </Fragment>
          ))}
        </ul>
      </section>
      {functions.length > 0 && (
        <section>
          <SectionHeader title="Functions" />
          <ul className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            {functions.map((d) => (
              <DivisionRow key={d.code} division={d} count={counts.get(d.code) ?? 0} />
            ))}
          </ul>
        </section>
      )}
      <Link to="/personal" className="text-sm font-medium text-brand underline">
        Personal to-dos →
      </Link>
    </div>
  );
}
