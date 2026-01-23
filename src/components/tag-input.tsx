"use client";

import { useState, useEffect } from "react";
import { Plus, Tag as TagIcon, Trash2 } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TagBadge } from "@/components/tag-badge";
import type { Tag } from "@/lib/types";

interface TagInputProps {
  digestId: string;
  initialTags: Tag[];
}

interface OptimisticTag extends Tag {
  isPending?: boolean;
}

const MAX_TAGS = 20;

export function TagInput({ digestId, initialTags }: TagInputProps) {
  const [tags, setTags] = useState<OptimisticTag[]>(initialTags);
  const [userTags, setUserTags] = useState<Tag[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [open, setOpen] = useState(false);
  const [tagToDelete, setTagToDelete] = useState<Tag | null>(null);
  const [selectedValue, setSelectedValue] = useState("");

  // Fetch user's tag vocabulary for suggestions
  useEffect(() => {
    if (open) {
      fetch("/api/tags")
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setUserTags(data);
          }
        })
        .catch(console.error);
    }
  }, [open]);

  const addTag = async (tagName: string) => {
    const normalizedName = tagName.toLowerCase().trim();
    if (!normalizedName) return;

    // Check if tag already exists on this digest
    if (tags.some((t) => t.name === normalizedName)) {
      setInputValue("");
      return;
    }

    // Check tag limit
    if (tags.length >= MAX_TAGS) {
      return;
    }

    // Optimistic update with temporary ID
    const tempId = `temp-${Date.now()}`;
    const optimisticTag: OptimisticTag = {
      id: tempId,
      name: normalizedName,
      isPending: true,
    };
    setTags((prev) => [...prev, optimisticTag]);
    setInputValue("");

    try {
      const res = await fetch(`/api/digest/${digestId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: normalizedName }),
      });

      if (res.ok) {
        const newTag = await res.json();
        // Replace temp tag with real tag
        setTags((prev) =>
          prev.map((t) => (t.id === tempId ? { ...newTag, isPending: false } : t))
        );
      } else {
        // Remove optimistic tag on failure
        setTags((prev) => prev.filter((t) => t.id !== tempId));
      }
    } catch (error) {
      console.error("Failed to add tag:", error);
      // Remove optimistic tag on error
      setTags((prev) => prev.filter((t) => t.id !== tempId));
    }
  };

  const removeTag = async (tagId: string) => {
    // Optimistic update
    const removedTag = tags.find((t) => t.id === tagId);
    setTags((prev) => prev.filter((t) => t.id !== tagId));

    try {
      const res = await fetch(`/api/digest/${digestId}/tags/${tagId}`, {
        method: "DELETE",
      });

      if (!res.ok && removedTag) {
        // Revert on failure
        setTags((prev) => [...prev, removedTag]);
      }
    } catch (error) {
      console.error("Failed to remove tag:", error);
      if (removedTag) {
        setTags((prev) => [...prev, removedTag]);
      }
    }
  };

  const confirmDeleteTag = async () => {
    if (!tagToDelete) return;

    const tagId = tagToDelete.id;

    // Optimistic update - remove from suggestions
    setUserTags((prev) => prev.filter((t) => t.id !== tagId));

    // Also remove from current digest if applied
    if (tags.some((t) => t.id === tagId)) {
      setTags((prev) => prev.filter((t) => t.id !== tagId));
    }

    setTagToDelete(null);

    try {
      const res = await fetch(`/api/tags/${tagId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        // Revert on failure - refetch tags
        fetch("/api/tags")
          .then((res) => res.json())
          .then((data) => {
            if (Array.isArray(data)) {
              setUserTags(data);
            }
          });
      }
    } catch (error) {
      console.error("Failed to delete tag:", error);
    }
  };

  // Filter suggestions to exclude already-applied tags
  const suggestions = userTags.filter(
    (ut) => !tags.some((t) => t.name === ut.name)
  );

  // Check if input matches any existing suggestion exactly
  const normalizedInput = inputValue.toLowerCase().trim();
  const exactMatch = suggestions.some((s) => s.name === normalizedInput);
  const showCreateOption = normalizedInput.length > 0 && !exactMatch;

  const atLimit = tags.length >= MAX_TAGS;

  const handleSelect = (value: string) => {
    if (value.startsWith("create:")) {
      addTag(value.replace("create:", ""));
    } else {
      addTag(value);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((tag) => (
          <TagBadge
            key={tag.id}
            name={tag.name}
            size="md"
            onRemove={() => removeTag(tag.id)}
          />
        ))}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              disabled={atLimit}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add tag
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-auto min-w-48 max-w-64 sm:max-w-72 p-0"
            align="start"
          >
            <Command
              shouldFilter={true}
              loop
              value={selectedValue}
              onValueChange={setSelectedValue}
            >
              <CommandInput
                placeholder="Search or create tag..."
                value={inputValue}
                onValueChange={setInputValue}
                maxLength={50}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && selectedValue) {
                    e.preventDefault();
                    handleSelect(selectedValue);
                  }
                }}
              />
              <CommandList>
                <CommandEmpty>
                  {normalizedInput.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => addTag(normalizedInput)}
                      className="w-full px-2 py-1.5 text-sm text-left hover:bg-[var(--color-bg-tertiary)] rounded transition-colors"
                    >
                      Create &quot;{normalizedInput}&quot;
                    </button>
                  ) : (
                    <span className="text-[var(--color-text-tertiary)]">
                      Type to create a new tag
                    </span>
                  )}
                </CommandEmpty>

                {showCreateOption && (
                  <CommandGroup>
                    <CommandItem
                      value={`create:${normalizedInput}`}
                      onSelect={handleSelect}
                      className="data-[selected=true]:bg-[oklch(25%_0.03_25)] data-[selected=true]:text-[var(--color-text-primary)]"
                    >
                      <Plus className="w-4 h-4 mr-2 text-[var(--color-text-tertiary)]" />
                      Create &quot;{normalizedInput}&quot;
                    </CommandItem>
                  </CommandGroup>
                )}

                {suggestions.length > 0 && (
                  <CommandGroup heading="Your tags">
                    {suggestions.map((tag) => (
                      <CommandItem
                        key={tag.id}
                        value={tag.name}
                        onSelect={handleSelect}
                        className="group/item justify-between data-[selected=true]:bg-[oklch(25%_0.03_25)] data-[selected=true]:text-[var(--color-text-primary)]"
                      >
                        <span className="flex items-center">
                          <TagIcon className="w-4 h-4 mr-2 text-[var(--color-text-tertiary)]" />
                          {tag.name}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTagToDelete(tag);
                          }}
                          className="opacity-0 group-hover/item:opacity-100 p-0.5 rounded hover:bg-red-500/20 text-[var(--color-text-tertiary)] hover:text-red-500 transition-all"
                          aria-label={`Delete ${tag.name} from vocabulary`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>

            {atLimit && (
              <p className="px-3 pb-2 text-xs text-[var(--color-text-tertiary)]">
                Maximum of {MAX_TAGS} tags reached
              </p>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!tagToDelete} onOpenChange={(open) => !open && setTagToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete tag?</DialogTitle>
            <DialogDescription>
              This will permanently delete the tag &quot;{tagToDelete?.name}&quot; and remove it from all your digests. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteTag}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
