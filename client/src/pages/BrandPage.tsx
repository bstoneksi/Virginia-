import { useCallback, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { AgendaView } from "@/components/AgendaView";
import { Board } from "@/components/board/Board";
import { GroupBySelect } from "@/components/board/GroupBySelect";
import { Button, Segmented } from "@/components/Field";
import { FilterBar } from "@/components/FilterBar";
import { Icon } from "@/components/Icon";
import { NewItemModal } from "@/components/NewItemModal";
import { EmptyState } from "@/components/States";
import { useGroupBy } from "@/lib/boardPrefs";
import { useBootstrap } from "@/lib/bootstrap";
import { filtersFromParams, filtersToParams, type BoardFilters } from "@/lib/filters";
import { usePageTitle } from "@/lib/shell";

type Tab = "board" | "agenda";

export function BrandPage() {
  const { code = "" } = useParams();
  const { division } = useBootstrap();
  const div = division(code);
  usePageTitle(div ? div.name : code);
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "agenda" ? "agenda" : "board";
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const fixed = useMemo(() => ({ divisionCode: code }), [code]);
  const [groupBy, setGroupBy] = useGroupBy();
  // The division is fixed here, so a "Brand" grouping (shared with the main Board) collapses to the flat layout.
  const groupByHere = groupBy === "brand" ? "none" : groupBy;
  const [creating, setCreating] = useState(false);

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    if (next === "agenda") p.set("tab", "agenda");
    else p.delete("tab");
    setParams(p, { replace: true });
  };
  const onFilters = useCallback((next: BoardFilters) => setParams(filtersToParams(next, params), { replace: true }), [params, setParams]);

  if (!div) {
    return (
      <EmptyState
        title={`No division "${code}"`}
        action={
          <Link to="/brands" className="text-sm font-medium text-brand underline">
            Back to Brands
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center gap-3">
        <Link to="/brands" className="no-print -ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 md:hidden" aria-label="Back to brands">
          <Icon name="chevronLeft" />
        </Link>
        <span className="flex h-10 min-w-10 items-center justify-center rounded-md px-2 text-sm font-bold" style={{ background: div.color, color: div.textColor }}>
          {div.code}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold leading-tight text-slate-900">{div.name}</h2>
          <p className="text-xs text-slate-500">
            {div.kind === "brand" ? "Brand" : div.kind === "function" ? "Function" : "Personal"}
            {div.parentCode && ` · part of ${div.parentCode}`}
          </p>
        </div>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          size="sm"
          className="no-print"
          options={[
            { value: "board", label: "Board" },
            { value: "agenda", label: "Agenda" },
          ]}
        />
      </header>

      {tab === "board" ? (
        <>
          <FilterBar
            filters={filters}
            onChange={onFilters}
            hideDivision
            right={
              <Button variant="primary" onClick={() => setCreating(true)} className="ml-auto shrink-0">
                <Icon name="plus" className="h-4 w-4" /> New
              </Button>
            }
          />
          <GroupBySelect value={groupByHere} onChange={setGroupBy} hideBrand />
          <Board filters={filters} fixed={fixed} groupBy={groupByHere} />
          <NewItemModal open={creating} onClose={() => setCreating(false)} initial={{ divisionCode: div.code, ownerInitials: filters.owner }} />
        </>
      ) : (
        <AgendaView subject={{ type: "division", key: div.code }} quickAddDefaults={{ divisionCode: div.code }} />
      )}
    </div>
  );
}
