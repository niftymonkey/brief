"use client";

import { useQueryState, parseAsArrayOf, parseAsString, parseAsIsoDate } from "nuqs";
import { useTransition } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function ActiveFilters() {
  const [isPending, startTransition] = useTransition();

  const [selectedTags, setSelectedTags] = useQueryState(
    "tags",
    parseAsArrayOf(parseAsString, ",").withOptions({
      shallow: false,
      startTransition,
    })
  );

  const [dateFrom, setDateFrom] = useQueryState(
    "dateFrom",
    parseAsIsoDate.withOptions({
      shallow: false,
      startTransition,
    })
  );

  const [dateTo, setDateTo] = useQueryState(
    "dateTo",
    parseAsIsoDate.withOptions({
      shallow: false,
      startTransition,
    })
  );

  const tags = selectedTags ?? [];
  const hasFilters = tags.length > 0 || dateFrom !== null || dateTo !== null;

  if (!hasFilters) {
    return null;
  }

  const removeTag = (tagName: string) => {
    const newTags = tags.filter((t) => t !== tagName);
    setSelectedTags(newTags.length > 0 ? newTags : null);
  };

  const clearAll = () => {
    setSelectedTags(null);
    setDateFrom(null);
    setDateTo(null);
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    });
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 flex-wrap px-4 py-2 border-b border-[var(--color-border)]",
        "bg-[var(--color-bg-primary)]",
        isPending && "opacity-70"
      )}
    >
      <span className="text-xs text-[var(--color-text-tertiary)] mr-1">Filters:</span>

      {/* Tag chips */}
      {tags.map((tag) => (
        <FilterChip
          key={tag}
          label={`Tag: ${tag}`}
          onRemove={() => removeTag(tag)}
        />
      ))}

      {/* Date chips */}
      {dateFrom && (
        <FilterChip
          label={`From: ${formatDate(dateFrom)}`}
          onRemove={() => setDateFrom(null)}
        />
      )}
      {dateTo && (
        <FilterChip
          label={`To: ${formatDate(dateTo)}`}
          onRemove={() => setDateTo(null)}
        />
      )}

      {/* Clear all button */}
      <button
        onClick={clearAll}
        className="ml-auto text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        Clear all
      </button>
    </div>
  );
}

interface FilterChipProps {
  label: string;
  onRemove: () => void;
}

function FilterChip({ label, onRemove }: FilterChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full",
        "bg-[var(--color-bg-secondary)] border border-[var(--color-border)]",
        "text-[var(--color-text-secondary)]"
      )}
    >
      {label}
      <button
        onClick={onRemove}
        className="p-0.5 rounded-full hover:bg-[var(--color-bg-tertiary)] transition-colors"
        aria-label={`Remove ${label} filter`}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
