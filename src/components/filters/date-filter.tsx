"use client";

import { useQueryState, parseAsIsoDate } from "nuqs";
import { useTransition } from "react";
import { Calendar, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function DateFilter() {
  const [isPending, startTransition] = useTransition();

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

  const hasSelection = dateFrom !== null || dateTo !== null;

  const clearAll = () => {
    setDateFrom(null);
    setDateTo(null);
  };

  const setPreset = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setDateFrom(from);
    setDateTo(to);
  };

  const setThisYear = () => {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    setDateFrom(startOfYear);
    setDateTo(now);
  };

  // Format date for display
  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  // Get display label
  const getLabel = () => {
    if (dateFrom && dateTo) {
      return `${formatDate(dateFrom)} - ${formatDate(dateTo)}`;
    }
    if (dateFrom) return `From ${formatDate(dateFrom)}`;
    if (dateTo) return `To ${formatDate(dateTo)}`;
    return "Date";
  };

  // Format date for input value (YYYY-MM-DD)
  const toInputValue = (date: Date | null) => {
    if (!date) return "";
    return date.toISOString().split("T")[0];
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1.5",
            hasSelection && "bg-[var(--color-accent)]/10 border-[var(--color-accent)]/30",
            isPending && "opacity-70"
          )}
        >
          <Calendar className="w-4 h-4" />
          <span className="max-w-32 truncate">{getLabel()}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
          <span className="text-sm font-medium">Filter by Date</span>
          {hasSelection && (
            <button
              onClick={clearAll}
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>

        {/* Quick presets */}
        <div className="flex gap-1.5 px-3 py-2 border-b border-[var(--color-border)]">
          <button
            onClick={() => setPreset(7)}
            className="px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
          >
            Last 7 days
          </button>
          <button
            onClick={() => setPreset(30)}
            className="px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
          >
            Last 30 days
          </button>
          <button
            onClick={setThisYear}
            className="px-2 py-1 text-xs rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
          >
            This year
          </button>
        </div>

        {/* Date inputs */}
        <div className="p-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="date-from" className="text-xs text-[var(--color-text-secondary)]">
              From
            </Label>
            <input
              id="date-from"
              type="date"
              value={toInputValue(dateFrom)}
              max={toInputValue(dateTo) || undefined}
              onChange={(e) => {
                const value = e.target.value;
                setDateFrom(value ? new Date(value) : null);
              }}
              className={cn(
                "w-full px-2 py-1.5 text-sm rounded border",
                "bg-[var(--color-bg-secondary)] border-[var(--color-border)]",
                "focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date-to" className="text-xs text-[var(--color-text-secondary)]">
              To
            </Label>
            <input
              id="date-to"
              type="date"
              value={toInputValue(dateTo)}
              min={toInputValue(dateFrom) || undefined}
              onChange={(e) => {
                const value = e.target.value;
                setDateTo(value ? new Date(value) : null);
              }}
              className={cn(
                "w-full px-2 py-1.5 text-sm rounded border",
                "bg-[var(--color-bg-secondary)] border-[var(--color-border)]",
                "focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
              )}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
