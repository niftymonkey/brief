"use client";

import { useQueryState, parseAsArrayOf, parseAsString, parseAsIsoDate } from "nuqs";
import { DigestCard } from "@/components/digest-card";
import { DigestGrid } from "@/components/library-content";
import { NewDigestDialog } from "@/components/new-digest-dialog";
import type { DigestSummary } from "@/lib/types";

interface FilteredDigestGridProps {
  digests: DigestSummary[];
  hasAccess: boolean;
}

export function FilteredDigestGrid({ digests, hasAccess }: FilteredDigestGridProps) {
  const [selectedTags] = useQueryState("tags", parseAsArrayOf(parseAsString, ","));
  const [dateFrom] = useQueryState("dateFrom", parseAsIsoDate);
  const [dateTo] = useQueryState("dateTo", parseAsIsoDate);

  const tags = selectedTags ?? [];

  // Client-side filtering -- instant, no server round-trip
  const filtered = digests.filter((digest) => {
    // Tag filter (AND logic: digest must have ALL selected tags)
    if (tags.length > 0) {
      const digestTagNames = digest.tags?.map((t) => t.name) ?? [];
      if (!tags.every((tag) => digestTagNames.includes(tag))) {
        return false;
      }
    }

    // Date range filter
    const createdAt = new Date(digest.createdAt);
    if (dateFrom && createdAt < dateFrom) {
      return false;
    }
    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setUTCHours(23, 59, 59, 999);
      if (createdAt > endOfDay) {
        return false;
      }
    }

    return true;
  });

  const hasFilters = tags.length > 0 || dateFrom !== null || dateTo !== null;

  if (filtered.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--color-text-secondary)]">
          {hasFilters ? "No digests match your filters" : "No digests yet"}
        </p>
        {!hasFilters && hasAccess && (
          <div className="mt-4">
            <NewDigestDialog variant="outline" />
          </div>
        )}
      </div>
    );
  }

  return (
    <DigestGrid>
      {filtered.map((digest) => (
        <DigestCard key={digest.id} digest={digest} />
      ))}
    </DigestGrid>
  );
}
