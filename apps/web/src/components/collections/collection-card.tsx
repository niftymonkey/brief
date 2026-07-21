import Link from "next/link";
import { Layers } from "lucide-react";
import type { Collection } from "@/lib/collections";

interface CollectionCardProps {
  collection: Collection;
}

export function CollectionCard({ collection }: CollectionCardProps) {
  const { itemCount } = collection;

  return (
    <Link
      href={`/collections/${collection.id}`}
      className="group flex flex-col p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:shadow-[var(--shadow-md)] transition-all"
    >
      <div className="flex items-start gap-2 mb-2">
        <Layers className="w-4 h-4 mt-1 shrink-0 text-[var(--color-text-tertiary)]" />
        <h3 className="font-medium text-[var(--color-text-primary)] line-clamp-2 leading-snug group-hover:text-[var(--color-accent)] transition-colors">
          {collection.title}
        </h3>
      </div>

      <div className="flex-1 min-h-[2.5rem]">
        {collection.description ? (
          <p className="text-sm text-[var(--color-text-secondary)] line-clamp-3">
            {collection.description}
          </p>
        ) : (
          <p className="text-sm text-[var(--color-text-tertiary)] italic">
            No description
          </p>
        )}
      </div>

      <div className="mt-auto pt-2 text-sm border-t border-[var(--color-border)]">
        <span className="text-[var(--color-text-secondary)]">
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>
      </div>
    </Link>
  );
}
