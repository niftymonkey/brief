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
 * Given the current ordered item ids and the index of the item being moved one
 * slot up or down, returns the neighbor ids the reorder PATCH needs so the server
 * can compute a fractional midpoint. `afterItemId` is the item the moved item
 * should follow; `beforeItemId` is the item it should precede. Returns null when
 * the move would run off either end (already first and moving up, already last and
 * moving down).
 */
export function reorderNeighbors(
  ids: string[],
  index: number,
  direction: "up" | "down",
): ReorderNeighbors | null {
  if (index < 0 || index >= ids.length) return null;

  if (direction === "up") {
    if (index === 0) return null;
    return {
      afterItemId: ids[index - 2] ?? null,
      beforeItemId: ids[index - 1],
    };
  }

  if (index === ids.length - 1) return null;
  return {
    afterItemId: ids[index + 1],
    beforeItemId: ids[index + 2] ?? null,
  };
}
