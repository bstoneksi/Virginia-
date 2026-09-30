import { useEffect, useState, type ReactNode } from "react";
import type { Category } from "@shared/types";
import { CATEGORIES, CATEGORY_COLORS, CATEGORY_LABELS } from "@shared/types";
import { useBootstrap } from "@/lib/bootstrap";
import { EMPTY_FILTERS, hasActiveFilters, type BoardFilters } from "@/lib/filters";
import { Select, TextInput, compactTapClass } from "./Field";

interface FilterBarProps {
  filters: BoardFilters;
  onChange: (next: BoardFilters) => void;
  /** Hide the division select when the page already fixes the division (brand page). */
  hideDivision?: boolean;
  right?: ReactNode;
}

export function FilterBar({ filters, onChange, hideDivision = false, right }: FilterBarProps) {
  const { divisions, people } = useBootstrap();
  const [text, setText] = useState(filters.q);

  useEffect(() => setText(filters.q), [filters.q]);
  useEffect(() => {
    if (text === filters.q) return;
    const id = window.setTimeout(() => onChange({ ...filters, q: text }), 300);
    return () => window.clearTimeout(id);
  }, [text, filters, onChange]);

  const toggleCategory = (c: Category) => {
    const has = filters.categories.includes(c);
    onChange({ ...filters, categories: has ? filters.categories.filter((x) => x !== c) : [...filters.categories, c] });
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Phone: text on its own row, then selects + action. Desktop: everything on one row. */}
      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Filter by text…"
          aria-label="Filter by text"
          className="!w-full min-w-0 sm:!w-auto sm:flex-1 sm:basis-48"
        />
        <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-auto sm:flex-none">
          {!hideDivision && (
            <Select value={filters.division ?? ""} onChange={(e) => onChange({ ...filters, division: e.target.value || null })} aria-label="Division" className="min-w-0 flex-1 basis-0 sm:!w-auto sm:flex-none sm:basis-[10rem]">
              <option value="">All divisions</option>
              {divisions.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.code} · {d.name}
                </option>
              ))}
            </Select>
          )}
          <Select value={filters.owner ?? ""} onChange={(e) => onChange({ ...filters, owner: e.target.value || null })} aria-label="Owner" className="min-w-0 flex-1 basis-0 sm:!w-auto sm:flex-none sm:basis-[10rem]">
            <option value="">Anyone</option>
            {people.map((p) => (
              <option key={p.initials} value={p.initials}>
                {p.initials} · {p.fullName}
              </option>
            ))}
          </Select>
          {right}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {CATEGORIES.map((c) => {
          const active = filters.categories.includes(c);
          const color = CATEGORY_COLORS[c];
          return (
            <button
              key={c}
              type="button"
              aria-pressed={active}
              title={CATEGORY_LABELS[c]}
              onClick={() => toggleCategory(c)}
              style={active ? { background: color.bg, color: color.fg, borderColor: color.fg } : undefined}
              className={`${compactTapClass} min-w-11 rounded-md border px-2.5 text-xs font-bold md:min-w-0 ${active ? "" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
            >
              {c}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={filters.personal}
          onClick={() => onChange({ ...filters, personal: !filters.personal })}
          className={`${compactTapClass} rounded-md border px-2.5 text-xs font-semibold ${filters.personal ? "border-[#B08968] bg-[#B08968] text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
        >
          Personal
        </button>
        {hasActiveFilters(filters) && (
          <button type="button" onClick={() => onChange({ ...EMPTY_FILTERS })} className={`${compactTapClass} px-2 text-xs font-medium text-brand underline`}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
