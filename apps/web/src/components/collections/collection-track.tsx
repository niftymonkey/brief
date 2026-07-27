import { cn } from "@/lib/utils";
import { formatSeconds } from "@/lib/collection-item-input";
import { isEntryActive, type CollectionEntry } from "@/lib/collection-entries";

interface CollectionTrackProps {
  entries: CollectionEntry[];
  totalRuntimeSec: number;
  /** The entry the player is on, drawn filled so the sitting shows its position. */
  activeEntryId: string | null;
}

/**
 * Proportional map of the sitting: one segment per entry, sized by its share of
 * the total runtime, each one a link to the entry it stands for.
 */
export function CollectionTrack({ entries, totalRuntimeSec, activeEntryId }: CollectionTrackProps) {
  if (entries.length === 0 || totalRuntimeSec <= 0) return null;

  return (
    <div>
      <div className="flex gap-[2px] mt-2.5">
        {entries.map((entry) => (
          <a
            key={entry.id}
            href={`#${entry.anchorId}`}
            title={`${entry.ordinal}. ${entry.title}, ${formatSeconds(entry.durationSec ?? 0)}`}
            aria-label={`Entry ${entry.ordinal}, ${entry.title}`}
            style={{ flexGrow: Math.max(entry.durationSec ?? 0, 1), flexBasis: 0 }}
            className={cn(
              "h-2.5 rounded-full border transition-colors",
              isEntryActive(entry, activeEntryId)
                ? "bg-[var(--color-accent)] border-[var(--color-accent)]"
                : "bg-[var(--color-bg-tertiary)] border-[var(--color-border)]",
              "hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)]",
            )}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1.5 font-mono text-[0.625rem] text-[var(--color-text-tertiary)]">
        <span>0:00</span>
        <span>{formatSeconds(totalRuntimeSec)}</span>
      </div>
    </div>
  );
}
