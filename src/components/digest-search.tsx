"use client";

import { useQueryState, parseAsString } from "nuqs";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useTransition } from "react";

const DEBOUNCE_MS = 300;

export function DigestSearch() {
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useQueryState(
    "search",
    parseAsString.withOptions({
      shallow: false,
      startTransition,
    })
  );

  // Local state for immediate input responsiveness
  const [inputValue, setInputValue] = useState(search ?? "");

  // Sync local state when URL changes (e.g., browser back/forward)
  useEffect(() => {
    setInputValue(search ?? "");
  }, [search]);

  // Debounce: only update URL after user stops typing
  useEffect(() => {
    const timeout = setTimeout(() => {
      const newValue = inputValue || null;
      if (newValue !== search) {
        setSearch(newValue);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [inputValue, search, setSearch]);

  return (
    <div className="relative mb-6">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--color-text-tertiary)]" />
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder="Search digests..."
        className={cn(
          "w-full pl-10 pr-4 py-2.5 text-base",
          "bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg",
          "placeholder:text-[var(--color-text-tertiary)]",
          "focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20",
          "transition-all",
          isPending && "opacity-70"
        )}
      />
    </div>
  );
}
