/**
 * Board layout preferences that live in this browser (localStorage), not in the tracker.
 * Every storage access is wrapped: private windows and blocked site data must not break the Board.
 */
import { useCallback, useState } from "react";
import { isGroupMode, type GroupMode } from "@shared/boardGroups";

/**
 * Board layout before the owner has picked one. Brandon decides the default next review round —
 * change this constant and nothing else.
 */
export const DEFAULT_GROUP_BY: GroupMode = "person";

export const GROUP_BY_STORAGE_KEY = "virginia.board.groupBy";

export function readGroupBy(): GroupMode {
  try {
    const raw = window.localStorage.getItem(GROUP_BY_STORAGE_KEY);
    return isGroupMode(raw) ? raw : DEFAULT_GROUP_BY;
  } catch {
    return DEFAULT_GROUP_BY;
  }
}

export function writeGroupBy(mode: GroupMode): void {
  try {
    window.localStorage.setItem(GROUP_BY_STORAGE_KEY, mode);
  } catch {
    // Storage unavailable: the choice simply lasts for this page view.
  }
}

/** The persisted "Group by" choice: read once on mount, written through on every change. */
export function useGroupBy(): [GroupMode, (mode: GroupMode) => void] {
  const [mode, setMode] = useState<GroupMode>(readGroupBy);
  const update = useCallback((next: GroupMode) => {
    setMode(next);
    writeGroupBy(next);
  }, []);
  return [mode, update];
}
