"use client";

import { useQueryState, parseAsArrayOf, parseAsString } from "nuqs";
import { useTransition } from "react";
import { Tag as TagIcon, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
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

interface TagFilterProps {
  availableTags: Tag[];
}

export function TagFilter({ availableTags }: TagFilterProps) {
  const [isPending, startTransition] = useTransition();
  const [selectedTags, setSelectedTags] = useQueryState(
    "tags",
    parseAsArrayOf(parseAsString, ",").withOptions({
      shallow: false,
      startTransition,
    })
  );

  const selected = selectedTags ?? [];
  const hasSelection = selected.length > 0;

  const toggleTag = (tagName: string) => {
    if (selected.includes(tagName)) {
      const newTags = selected.filter((t) => t !== tagName);
      setSelectedTags(newTags.length > 0 ? newTags : null);
    } else {
      setSelectedTags([...selected, tagName]);
    }
  };

  const clearAll = () => {
    setSelectedTags(null);
  };

  if (availableTags.length === 0) {
    return null;
  }

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
          <TagIcon className="w-4 h-4" />
          <span>Tags</span>
          {hasSelection && (
            <span className="ml-0.5 px-1.5 py-0.5 text-xs rounded-full bg-[var(--color-accent)] text-white">
              {selected.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        <Command shouldFilter={true}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
            <span className="text-sm font-medium">Filter by Tags</span>
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
                    {tag.name}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
