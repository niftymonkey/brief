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

// Only self-referential constants remain (intrinsic to this component's own layout)
const TAG_GAP = 6; // Matches gap-1.5 (0.375rem)
const OVERFLOW_BUTTON_WIDTH = 50;

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

  const outerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(0);

  const selected = selectedTags ?? [];

  // Measure how many tags fit by reading the outer wrapper's actual width
  useLayoutEffect(() => {
    if (!measureRef.current || !outerRef.current || availableTags.length === 0) {
      setVisibleCount(availableTags.length);
      return;
    }

    const calculateVisibleTags = () => {
      const measureContainer = measureRef.current;
      const outer = outerRef.current;
      if (!measureContainer || !outer) return;

      // The outer wrapper (flex-1 min-w-0) is sized by CSS -- just read it
      const availableWidth = outer.clientWidth;

      // Measure actual tag widths from the hidden measurement container
      const tagElements = measureContainer.querySelectorAll("[data-tag]");
      const tagWidths: number[] = [];
      tagElements.forEach((el) => {
        tagWidths.push((el as HTMLElement).offsetWidth);
      });

      // Calculate total width of all tags
      const totalTagsWidth = tagWidths.reduce(
        (sum, w, i) => sum + w + (i > 0 ? TAG_GAP : 0),
        0
      );

      // If all tags fit, show all
      if (totalTagsWidth <= availableWidth) {
        setVisibleCount(availableTags.length);
        return;
      }

      // Otherwise, calculate how many fit with overflow button
      let usedWidth = 0;
      let count = 0;

      for (let i = 0; i < tagWidths.length; i++) {
        const tagWidth = tagWidths[i];
        const widthNeeded = tagWidth + (count > 0 ? TAG_GAP : 0);
        const reservedForOverflow = OVERFLOW_BUTTON_WIDTH + TAG_GAP;

        if (usedWidth + widthNeeded + reservedForOverflow <= availableWidth) {
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

    // Recalculate when the outer wrapper resizes (CSS handles the sizing)
    const resizeObserver = new ResizeObserver(calculateVisibleTags);
    resizeObserver.observe(outerRef.current);

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
        {tag.usageCount !== undefined && (
          <span className={cn(
            "text-[10px] leading-none relative top-px",
            isSelected
              ? "text-white/50"
              : "text-[var(--color-text-tertiary)]/60"
          )}>
            {tag.usageCount}
          </span>
        )}
        {isSelected && !isMeasure && <X className="w-3 h-3" />}
      </button>
    );
  };

  return (
    <div ref={outerRef} className="flex-1 min-w-0 relative">
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

      {/* Visible tags */}
      <div
        ref={containerRef}
        className={cn(
          "flex items-center gap-1.5",
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
    </div>
  );
}
