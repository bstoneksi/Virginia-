import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Board } from "@/components/board/Board";
import { GroupBySelect } from "@/components/board/GroupBySelect";
import { Button } from "@/components/Field";
import { FilterBar } from "@/components/FilterBar";
import { Icon } from "@/components/Icon";
import { NewItemModal } from "@/components/NewItemModal";
import { useGroupBy } from "@/lib/boardPrefs";
import { filtersFromParams, filtersToParams, type BoardFilters } from "@/lib/filters";
import { usePageTitle } from "@/lib/shell";

export function BoardPage() {
  usePageTitle("Board");
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const [groupBy, setGroupBy] = useGroupBy();
  const [creating, setCreating] = useState(false);

  const onChange = useCallback(
    (next: BoardFilters) => setParams(filtersToParams(next, params), { replace: true }),
    [params, setParams],
  );

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        filters={filters}
        onChange={onChange}
        right={
          <Button variant="primary" onClick={() => setCreating(true)} className="ml-auto shrink-0">
            <Icon name="plus" className="h-4 w-4" /> New
          </Button>
        }
      />
      {/* Layout control, not a filter: lives in this browser (localStorage), not in the URL. */}
      <GroupBySelect value={groupBy} onChange={setGroupBy} />
      <Board filters={filters} groupBy={groupBy} />
      <NewItemModal
        open={creating}
        onClose={() => setCreating(false)}
        initial={{
          divisionCode: filters.division,
          ownerInitials: filters.owner,
          category: filters.categories.length === 1 ? filters.categories[0] : undefined,
          isPersonal: filters.personal,
        }}
      />
    </div>
  );
}
