/**
 * Tiny in-memory bus so the shared Item drawer can tell list pages about edits
 * without every page re-fetching. Module-level: no provider needed.
 */
import { useEffect, useRef } from "react";
import type { Item } from "@shared/types";

export type ItemChange = { type: "created" | "updated"; item: Item } | { type: "deleted"; id: string };

type Listener = (change: ItemChange) => void;
const listeners = new Set<Listener>();

export function emitItemChange(change: ItemChange): void {
  for (const listener of listeners) listener(change);
}

export function useItemChanges(handler: Listener): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener: Listener = (change) => ref.current(change);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}

/** Apply a change to a plain list of items (replace / remove; `created` prepends). */
export function applyItemChange(list: Item[], change: ItemChange): Item[] {
  switch (change.type) {
    case "deleted":
      return list.filter((i) => i.id !== change.id);
    case "updated":
      return list.some((i) => i.id === change.item.id) ? list.map((i) => (i.id === change.item.id ? change.item : i)) : list;
    case "created":
      return list.some((i) => i.id === change.item.id) ? list : [change.item, ...list];
  }
}
