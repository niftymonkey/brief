"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CollectionItemRow,
  type CollectionItemRowControls,
} from "@/components/collections/collection-item-row";
import type { CollectionEntry } from "@/lib/collection-entries";
import type { CollectionItem } from "@/lib/collections";

interface SortableItemRowProps {
  item: CollectionItem;
  entry: CollectionEntry;
  isLast: boolean;
  isActive: boolean;
  /** True while a reorder is in flight, so a second drag cannot race the write. */
  dragDisabled: boolean;
  controls: CollectionItemRowControls;
}

/**
 * One entry row, made draggable.
 *
 * The hook lives here rather than in `CollectionItemRow` for two reasons.
 * `useSortable` requires an enclosing `DndContext`, and the reader's page renders
 * the same rows with no context and nothing to reorder. And keeping the row free
 * of the drag library leaves it a plain component that renders from props, which
 * is what lets it be tested without mounting a drag context at all.
 */
export function SortableItemRow({
  item,
  entry,
  isLast,
  isActive,
  dragDisabled,
  controls,
}: SortableItemRowProps) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: dragDisabled });

  return (
    <CollectionItemRow
      item={item}
      entry={entry}
      isLast={isLast}
      isActive={isActive}
      controls={controls}
      drag={{
        setNodeRef,
        setGripRef: setActivatorNodeRef,
        // `transition` is null between drags; the row must then move with no
        // animation at all, or every settled reorder replays as a slide.
        style: { transform: CSS.Translate.toString(transform), transition: transition ?? undefined },
        gripProps: { ...attributes, ...listeners },
        isDragging,
      }}
    />
  );
}
