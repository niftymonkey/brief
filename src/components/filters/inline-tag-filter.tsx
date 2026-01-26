"use client";

import { useQueryState, parseAsArrayOf, parseAsString } from "nuqs";
import { useTransition, useRef, useState, useLayoutEffect } from "react";
import { Tag as TagIcon, X, Check, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { Tag } from "@/lib/types";

// Layout constants (in pixels)
const LAYOUT = {
  GAP_3: 12, // Tailwind gap-3
  GAP_1_5: 6, // Tailwind gap-1.5
  SEPARATOR_WIDTH: 1,
  SEARCH_MIN_WIDTH: 400,
  SIDEBAR_TOGGLE_WIDTH: 44,
  DATE_FILTER_WIDTH_XL: 280, // Full presets visible
  DATE_FILTER_WIDTH_SMALL: 32, // Just calendar icon
  OVERFLOW_BUTTON_WIDTH: 50,
  TOOLBAR_PADDING: 32, // px-4 on both sides
  XL_BREAKPOINT: 1280,
  NOWRAP_BREAKPOINT: 900, // Above this, CSS forces single line
} as const;

interface InlineTagFilterProps {
  availableTags: Tag[];
}

export function InlineTagFilter({ availableTags }: InlineTagFilterProps) {
  const [isPending, startTransition] = useTransition();
  const [selectedTags, setSelectedTags] = useQueryState(
    "tags",
    parseAsArrayOf(parseAsString, ",").withOptions({
      shallow: false,
      startTransition,
    })
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  // Start with 0 - let calculation determine correct count (avoids chicken-and-egg)
  const [visibleCount, setVisibleCount] = useState(0);

  const selected = selectedTags ?? [];

  // Measure how many tags fit while preserving search bar minimum width
  useLayoutEffect(() => {
    if (!measureRef.current || availableTags.length === 0) {
      setVisibleCount(availableTags.length);
      return;
    }

    const calculateVisibleTags = () => {
      const measureContainer = measureRef.current;
      if (!measureContainer) return;

      const toolbar = measureContainer.closest("[data-toolbar]");
      const filterSection = measureContainer.closest("[data-filter-section]");
      if (!toolbar || !filterSection) {
        setVisibleCount(availableTags.length);
        return;
      }

      // Detect if layout has wrapped by checking vertical positions
      const searchContainer = toolbar.querySelector(
        "[data-search-container]"
      ) as HTMLElement | null;
      const isWrapped =
        searchContainer &&
        filterSection instanceof HTMLElement &&
        filterSection.offsetTop > searchContainer.offsetTop;

      const toolbarWidth = (toolbar as HTMLElement).offsetWidth;
      const separatorWidth = LAYOUT.SEPARATOR_WIDTH + LAYOUT.GAP_3 * 2;

      // Date filter width depends on viewport
      const isXl = window.innerWidth >= LAYOUT.XL_BREAKPOINT;
      const dateFilterWidth = isXl
        ? LAYOUT.DATE_FILTER_WIDTH_XL
        : LAYOUT.DATE_FILTER_WIDTH_SMALL;

      // Calculate theoretical space for filter section based on toolbar minus fixed elements
      // This avoids the chicken-and-egg problem where filter section size depends on tag count
      const sidebarToggle = toolbar.querySelector('[aria-label*="sidebar"]') ? LAYOUT.SIDEBAR_TOGGLE_WIDTH + LAYOUT.GAP_3 : 0;
      const searchMaxWidth = 600; // Matches max-w-[600px] on search container
      const theoreticalFilterSpace = toolbarWidth - Math.min(searchMaxWidth, toolbarWidth * 0.5) - sidebarToggle - LAYOUT.TOOLBAR_PADDING;

      // Calculate space available for tags within the filter section
      // When wrapped: filter section has full toolbar width (search is on its own row)
      // When single line: use theoretical space (accounts for search bar)
      const availableForTags = isWrapped
        ? toolbarWidth - LAYOUT.TOOLBAR_PADDING - dateFilterWidth - LAYOUT.SEPARATOR_WIDTH - LAYOUT.GAP_3 * 2
        : theoreticalFilterSpace - dateFilterWidth - separatorWidth * 2 - LAYOUT.GAP_3;

      // Measure actual tag widths from the hidden measurement container
      const tagElements = measureContainer.querySelectorAll("[data-tag]");
      const tagWidths: number[] = [];
      tagElements.forEach((el) => {
        tagWidths.push((el as HTMLElement).offsetWidth);
      });

      // Calculate total width of all tags
      const totalTagsWidth = tagWidths.reduce(
        (sum, w, i) => sum + w + (i > 0 ? LAYOUT.GAP_1_5 : 0),
        0
      );

      // If all tags fit, show all
      if (totalTagsWidth <= availableForTags) {
        setVisibleCount(availableTags.length);
        return;
      }

      // Otherwise, calculate how many fit with overflow button
      let usedWidth = 0;
      let count = 0;

      for (let i = 0; i < tagWidths.length; i++) {
        const tagWidth = tagWidths[i];
        const widthNeeded = tagWidth + (count > 0 ? LAYOUT.GAP_1_5 : 0);
        const reservedForOverflow =
          LAYOUT.OVERFLOW_BUTTON_WIDTH + LAYOUT.GAP_1_5;

        if (usedWidth + widthNeeded + reservedForOverflow <= availableForTags) {
          usedWidth += widthNeeded;
          count++;
        } else {
          break;
        }
      }

      setVisibleCount(Math.max(1, count));
    };

    // Initial calculation
    calculateVisibleTags();

    // Recalculate on resize - observe both toolbar and filter section
    const resizeObserver = new ResizeObserver(calculateVisibleTags);
    const toolbar = measureRef.current?.closest("[data-toolbar]");
    const filterSection = measureRef.current?.closest("[data-filter-section]");
    if (toolbar) resizeObserver.observe(toolbar);
    if (filterSection) resizeObserver.observe(filterSection);

    return () => resizeObserver.disconnect();
  }, [availableTags]);

  const toggleTag = (tagName: string) => {
    if (selected.includes(tagName)) {
      const newTags = selected.filter((t) => t !== tagName);
      setSelectedTags(newTags.length > 0 ? newTags : null);
    } else {
      setSelectedTags([...selected, tagName]);
    }
  };

  if (availableTags.length === 0) {
    return null;
  }

  const visibleTags = availableTags.slice(0, visibleCount);
  const overflowCount = availableTags.length - visibleCount;

  const TagPill = ({ tag, isMeasure = false }: { tag: Tag; isMeasure?: boolean }) => {
    const isSelected = selected.includes(tag.name);
    return (
      <button
        data-tag={isMeasure ? tag.id : undefined}
        onClick={isMeasure ? undefined : () => toggleTag(tag.name)}
        className={cn(
          "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm whitespace-nowrap",
          "transition-all duration-150",
          isMeasure ? "" : "cursor-pointer",
          isSelected
            ? "bg-[var(--color-accent)] text-white"
            : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border-hover)] hover:text-[var(--color-text-primary)]"
        )}
        tabIndex={isMeasure ? -1 : undefined}
        aria-hidden={isMeasure ? true : undefined}
      >
        {tag.name}
        {isSelected && !isMeasure && <X className="w-3 h-3" />}
      </button>
    );
  };

  return (
    <>
      {/* Hidden measurement container - positioned at origin to prevent overflow */}
      <div
        ref={measureRef}
        className="absolute left-0 top-0 opacity-0 pointer-events-none flex items-center gap-1.5"
        aria-hidden="true"
      >
        {availableTags.map((tag) => (
          <TagPill key={`measure-${tag.id}`} tag={tag} isMeasure />
        ))}
      </div>

      {/* Visible tags - shrink-0 so they don't compress */}
      <div
        ref={containerRef}
        className={cn(
          "flex items-center gap-1.5 shrink-0",
          isPending && "opacity-70"
        )}
      >
        {visibleTags.map((tag) => (
          <TagPill key={tag.id} tag={tag} />
        ))}

        {/* Overflow popover - only if needed */}
        {overflowCount > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm whitespace-nowrap",
                  "bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]",
                  "hover:bg-[var(--color-border-hover)] hover:text-[var(--color-text-primary)]",
                  "transition-colors cursor-pointer"
                )}
              >
                +{overflowCount}
                <ChevronDown className="w-3 h-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-0">
              <Command shouldFilter={true}>
                <CommandInput placeholder="Search tags..." />
                <CommandList>
                  <CommandEmpty>No tags found.</CommandEmpty>
                  <CommandGroup>
                    {availableTags.map((tag) => {
                      const isChecked = selected.includes(tag.name);
                      return (
                        <CommandItem
                          key={tag.id}
                          value={tag.name}
                          onSelect={() => toggleTag(tag.name)}
                          className="cursor-pointer"
                        >
                          <div
                            className={cn(
                              "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border",
                              isChecked
                                ? "bg-primary border-primary text-primary-foreground"
                                : "border-input"
                            )}
                          >
                            {isChecked && <Check className="h-3 w-3" />}
                          </div>
                          <TagIcon className="mr-2 h-4 w-4 text-[var(--color-text-tertiary)]" />
                          <span className="flex-1">{tag.name}</span>
                          {tag.usageCount !== undefined && (
                            <span className="text-xs text-[var(--color-text-tertiary)]">
                              {tag.usageCount}
                            </span>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </>
  );
}
