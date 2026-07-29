/**
 * Formats a whole-second offset as a clock string (M:SS, or H:MM:SS past an hour).
 * Negative inputs are treated as zero.
 */
export function formatSeconds(total: number): string {
  const safe = Math.max(0, Math.floor(total));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

/**
 * Renders an optional start/end second range as human-readable text. An item with
 * neither bound points at the whole video and yields an empty string.
 */
export function formatRange(startSec: number | null, endSec: number | null): string {
  if (startSec === null && endSec === null) return "";
  if (startSec !== null && endSec !== null) {
    return `${formatSeconds(startSec)} - ${formatSeconds(endSec)}`;
  }
  if (startSec !== null) {
    return `from ${formatSeconds(startSec)}`;
  }
  return `to ${formatSeconds(endSec as number)}`;
}

export interface ReorderNeighbors {
  afterItemId: string | null;
  beforeItemId: string | null;
}

/**
 * Settles a drag: returns the order that results from dropping `movedId` onto
 * the slot `overId` occupies, with everything between them shifting one place to
 * make room. Returns the given order unchanged when either id is unknown or an
 * item was dropped on itself, so a drag that ends where it began costs nothing.
 *
 * Pure and non-mutating, so the caller can render the settled order optimistically
 * and still hold the previous one to fall back to if the write fails.
 */
export function reorderById(ids: string[], movedId: string, overId: string): string[] {
  const from = ids.indexOf(movedId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return ids;

  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, movedId);
  return next;
}

/**
 * Reads an item's neighbours out of an order that has already settled, which is
 * what the reorder PATCH needs so the server can compute a fractional midpoint.
 * `afterItemId` is the item it should follow; `beforeItemId` is the item it should
 * precede. Both are null for the only item in a collection. Returns null for an id
 * the order does not contain.
 */
export function neighborsOf(ids: string[], itemId: string): ReorderNeighbors | null {
  const index = ids.indexOf(itemId);
  if (index === -1) return null;

  return {
    afterItemId: ids[index - 1] ?? null,
    beforeItemId: ids[index + 1] ?? null,
  };
}
