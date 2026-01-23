import Image from "next/image";
import Link from "next/link";
import type { DigestSummary } from "@/lib/types";
import { TagBadge } from "@/components/tag-badge";

interface DigestCardProps {
  digest: DigestSummary;
}

export function DigestCard({ digest }: DigestCardProps) {
  const createdDate = new Date(digest.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <Link
      href={`/digest/${digest.id}`}
      className="group flex flex-col p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:shadow-[var(--shadow-md)] transition-all"
    >
      {/* Thumbnail */}
      <div className="aspect-video rounded-lg bg-[var(--color-bg-tertiary)] mb-3 overflow-hidden relative">
        {digest.thumbnailUrl ? (
          <Image
            src={digest.thumbnailUrl}
            alt={digest.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--color-text-tertiary)]">
            No thumbnail
          </div>
        )}
      </div>

      {/* Title - let it grow naturally, min-height for 1 line */}
      <div className="flex-1 min-h-[1.375rem]">
        <h3 className="font-medium text-[var(--color-text-primary)] line-clamp-2 leading-snug group-hover:text-[var(--color-accent)] transition-colors">
          {digest.title}
        </h3>
      </div>

      {/* Footer area - anchored to bottom */}
      <div className="mt-auto pt-2">
        {/* Tags row - only if tags exist */}
        {digest.tags && digest.tags.length > 0 && (
          <div className="flex items-center gap-1.5 mb-2 overflow-hidden">
            {digest.tags.slice(0, 3).map((tag) => (
              <TagBadge key={tag.id} name={tag.name} size="sm" />
            ))}
            {digest.tags.length > 3 && (
              <span className="text-xs text-[var(--color-text-tertiary)] shrink-0">
                +{digest.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Channel + date */}
        <div className="flex items-center justify-between text-sm border-t border-[var(--color-border)] pt-2">
          <span className="text-[var(--color-text-secondary)] truncate min-w-0">
            {digest.channelName}
          </span>
          <span className="text-[var(--color-text-secondary)] shrink-0 ml-2">
            {createdDate}
          </span>
        </div>
      </div>
    </Link>
  );
}
