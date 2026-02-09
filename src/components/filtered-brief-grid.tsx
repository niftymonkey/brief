"use client";

import { useQueryState, parseAsArrayOf, parseAsString, parseAsIsoDate } from "nuqs";
import { BriefCard } from "@/components/brief-card";
import { BriefGrid } from "@/components/library-content";
import { NewBriefDialog } from "@/components/new-brief-dialog";
import type { BriefSummary } from "@/lib/types";

interface FilteredBriefGridProps {
  briefs: BriefSummary[];
  hasAccess: boolean;
}

export function FilteredBriefGrid({ briefs, hasAccess }: FilteredBriefGridProps) {
  const [selectedTags] = useQueryState("tags", parseAsArrayOf(parseAsString, ","));
  const [dateFrom] = useQueryState("dateFrom", parseAsIsoDate);
  const [dateTo] = useQueryState("dateTo", parseAsIsoDate);

  const tags = selectedTags ?? [];

  // Client-side filtering -- instant, no server round-trip
  const filtered = briefs.filter((brief) => {
    // Tag filter (AND logic: brief must have ALL selected tags)
    if (tags.length > 0) {
      const briefTagNames = brief.tags?.map((t) => t.name) ?? [];
      if (!tags.every((tag) => briefTagNames.includes(tag))) {
        return false;
      }
    }

    // Date range filter
    const createdAt = new Date(brief.createdAt);
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
          {hasFilters ? "No briefs match your filters" : "No briefs yet"}
        </p>
        {!hasFilters && hasAccess && (
          <div className="mt-4">
            <NewBriefDialog variant="outline" />
          </div>
        )}
      </div>
    );
  }

  return (
    <BriefGrid>
      {filtered.map((brief) => (
        <BriefCard key={brief.id} brief={brief} />
      ))}
    </BriefGrid>
  );
}
