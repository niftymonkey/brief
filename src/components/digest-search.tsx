"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTransition } from "react";

interface DigestSearchProps {
  initialValue?: string;
}

export function DigestSearch({ initialValue }: DigestSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function handleSearch(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("search", value);
    } else {
      params.delete("search");
    }
    startTransition(() => {
      router.replace(`/digests?${params.toString()}`);
    });
  }

  return (
    <div className="relative mb-6">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--color-text-tertiary)]" />
      <input
        type="text"
        defaultValue={initialValue}
        onChange={(e) => handleSearch(e.target.value)}
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
