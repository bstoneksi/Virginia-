import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item } from "@shared/types";
import { ItemCard } from "../ItemCard";

interface BoardCardProps {
  item: Item;
  onOpen: (item: Item) => void;
}

/**
 * Sortable wrapper around ItemCard. dnd-kit's `attributes` already make the wrapper a focusable
 * `role="button"` (Space/Enter picks the card up for keyboard dragging), so the click-to-open
 * handler lives here too rather than on a nested button inside.
 */
export function BoardCard({ item, onOpen }: BoardCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { status: item.status },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, touchAction: "manipulation" }}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(item)}
      aria-label={`${item.category}: ${item.title}`}
      className={`cursor-grab select-none rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 active:cursor-grabbing ${isDragging ? "opacity-30" : ""}`}
    >
      <ItemCard item={item} variant="card" className="hover:border-slate-300" />
    </div>
  );
}

/** Static rendering used inside the DragOverlay. */
export function BoardCardGhost({ item }: { item: Item }) {
  return (
    <div className="rotate-1 cursor-grabbing shadow-xl">
      <ItemCard item={item} variant="card" />
    </div>
  );
}
