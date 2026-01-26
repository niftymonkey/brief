"use client";

import { useQueryState, parseAsIsoDate } from "nuqs";
import { useTransition } from "react";
import { Calendar, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type PresetKey = "24h" | "2d" | "3d" | "7d" | "30d" | "year";

interface Preset {
  key: PresetKey;
  label: string;
  getRange: () => { from: Date; to: Date };
}

const presets: Preset[] = [
  {
    key: "24h",
    label: "24h",
    getRange: () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 1);
      return { from, to };
    },
  },
  {
    key: "2d",
    label: "2d",
    getRange: () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 2);
      return { from, to };
    },
  },
  {
    key: "3d",
    label: "3d",
    getRange: () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 3);
      return { from, to };
    },
  },
  {
    key: "7d",
    label: "7d",
    getRange: () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 7);
      return { from, to };
    },
  },
  {
    key: "30d",
    label: "30d",
    getRange: () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 30);
      return { from, to };
    },
  },
  {
    key: "year",
    label: "Year",
    getRange: () => {
      const to = new Date();
      const from = new Date(to.getFullYear(), 0, 1);
      return { from, to };
    },
  },
];

export function InlineDateFilter() {
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

  const hasDateFilter = dateFrom !== null || dateTo !== null;

  // Check which preset is currently active (if any)
  const getActivePreset = (): PresetKey | null => {
    if (!dateFrom) return null;

    for (const preset of presets) {
      const range = preset.getRange();
      // Compare dates (ignoring time)
      const fromMatch =
        dateFrom.toDateString() === range.from.toDateString();
      const toMatch =
        dateTo === null || dateTo.toDateString() === range.to.toDateString();
      if (fromMatch && toMatch) {
        return preset.key;
      }
    }
    return null;
  };

  const activePreset = getActivePreset();

  const applyPreset = (preset: Preset) => {
    const range = preset.getRange();
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  const clearDates = () => {
    setDateFrom(null);
    setDateTo(null);
  };

  const formatDateForInput = (date: Date | null): string => {
    if (!date) return "";
    return date.toISOString().split("T")[0];
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1 shrink-0",
        isPending && "opacity-70"
      )}
    >
      {/* Inline preset buttons - only on xl screens */}
      <div className="hidden xl:flex items-center gap-1">
        {presets.map((preset) => {
          const isActive = activePreset === preset.key;
          return (
            <button
              key={preset.key}
              onClick={() => {
                if (isActive) {
                  clearDates();
                } else {
                  applyPreset(preset);
                }
              }}
              className={cn(
                "px-2.5 py-1 rounded-full text-sm whitespace-nowrap",
                "transition-all duration-150 cursor-pointer",
                isActive
                  ? "bg-[var(--color-accent)] text-white"
                  : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border-hover)] hover:text-[var(--color-text-primary)]"
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Date popover - contains presets + custom range */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "p-1.5 rounded-full",
              "transition-all duration-150 cursor-pointer",
              hasDateFilter
                ? "bg-[var(--color-accent)] text-white"
                : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border-hover)] hover:text-[var(--color-text-primary)]"
            )}
            title="Date filter"
          >
            <Calendar className="w-4 h-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Date Range</span>
              {hasDateFilter && (
                <button
                  onClick={clearDates}
                  className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] flex items-center gap-1 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>

            {/* Quick presets */}
            <div className="flex flex-wrap gap-1.5">
              {presets.map((preset) => {
                const isActive = activePreset === preset.key;
                return (
                  <button
                    key={preset.key}
                    onClick={() => {
                      if (isActive) {
                        clearDates();
                      } else {
                        applyPreset(preset);
                      }
                    }}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-sm whitespace-nowrap",
                      "transition-all duration-150 cursor-pointer",
                      isActive
                        ? "bg-[var(--color-accent)] text-white"
                        : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border-hover)] hover:text-[var(--color-text-primary)]"
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {/* Custom date inputs */}
            <div className="space-y-3 pt-2 border-t border-[var(--color-border)]">
              <span className="text-xs text-[var(--color-text-tertiary)]">Custom range</span>
              <div>
                <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">
                  From
                </label>
                <input
                  type="date"
                  value={formatDateForInput(dateFrom)}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDateFrom(val ? new Date(val) : null);
                  }}
                  max={formatDateForInput(dateTo) || undefined}
                  className={cn(
                    "w-full px-3 py-2 text-sm rounded-lg",
                    "bg-[var(--color-bg-secondary)] border border-[var(--color-border)]",
                    "focus:outline-none focus:border-[var(--color-accent)]"
                  )}
                />
              </div>

              <div>
                <label className="text-xs text-[var(--color-text-secondary)] mb-1 block">
                  To
                </label>
                <input
                  type="date"
                  value={formatDateForInput(dateTo)}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDateTo(val ? new Date(val) : null);
                  }}
                  min={formatDateForInput(dateFrom) || undefined}
                  className={cn(
                    "w-full px-3 py-2 text-sm rounded-lg",
                    "bg-[var(--color-bg-secondary)] border border-[var(--color-border)]",
                    "focus:outline-none focus:border-[var(--color-accent)]"
                  )}
                />
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
