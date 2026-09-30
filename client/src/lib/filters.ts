import type { Category, Item, ItemFilters } from "@shared/types";
import { CATEGORIES } from "@shared/types";

/** Board filter bar state; serialised into the URL so views are shareable/back-button friendly. */
export interface BoardFilters {
  division: string | null;
  owner: string | null;
  categories: Category[];
  personal: boolean;
  q: string;
}

export const EMPTY_FILTERS: BoardFilters = { division: null, owner: null, categories: [], personal: false, q: "" };

export function filtersFromParams(params: URLSearchParams): BoardFilters {
  const cats = (params.get("cat") ?? "")
    .split(",")
    .filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c));
  return {
    division: params.get("division") || null,
    owner: params.get("owner") || null,
    categories: cats,
    personal: params.get("personal") === "1",
    q: params.get("q") ?? "",
  };
}

export function filtersToParams(filters: BoardFilters, base: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(base);
  const put = (key: string, value: string | null) => {
    if (value) params.set(key, value);
    else params.delete(key);
  };
  put("division", filters.division);
  put("owner", filters.owner);
  put("cat", filters.categories.length ? filters.categories.join(",") : null);
  put("personal", filters.personal ? "1" : null);
  put("q", filters.q.trim() || null);
  return params;
}

export function hasActiveFilters(f: BoardFilters): boolean {
  return Boolean(f.division || f.owner || f.categories.length || f.personal || f.q.trim());
}

export function toItemFilters(f: BoardFilters, extra: Partial<ItemFilters> = {}): ItemFilters {
  const out: ItemFilters = { ...extra };
  if (f.division) out.divisionCode = f.division;
  if (f.owner) out.ownerInitials = f.owner;
  if (f.categories.length) out.category = f.categories;
  if (f.personal) out.personal = true;
  if (f.q.trim()) out.q = f.q.trim();
  return out;
}

/** Client-side check so items created elsewhere only appear on a board when they belong there. */
export function itemMatchesFilters(item: Item, f: ItemFilters): boolean {
  if (f.divisionCode && item.divisionCode !== f.divisionCode) return false;
  if (f.ownerInitials && item.ownerInitials !== f.ownerInitials) return false;
  if (f.category && f.category.length && !f.category.includes(item.category)) return false;
  if (f.personal && !item.isPersonal) return false;
  if (f.initiativeId !== undefined && item.initiativeId !== f.initiativeId) return false;
  if (f.status && f.status.length && !f.status.includes(item.status)) return false;
  if (!f.includeDone && !f.status?.includes("Done") && item.status === "Done") return false;
  if (f.q) {
    const needle = f.q.toLowerCase();
    const hay = `${item.title} ${item.note} ${item.context ?? ""}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}
