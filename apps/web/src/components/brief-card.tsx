import Link from "next/link";
import type { BriefSummary } from "@/lib/types";
import { TagBadge } from "@/components/tag-badge";

interface BriefCardProps {
  brief: BriefSummary;
  activeTags?: string[];
  onTagClick?: (tagName: string) => void;
}

export function BriefCard({ brief, activeTags, onTagClick }: BriefCardProps) {
  const createdDate = new Date(brief.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <Link
      href={`/brief/${brief.id}`}
      className="group flex flex-col p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:shadow-[var(--shadow-md)] transition-all"
    >
      {/* Thumbnail */}
      <div className="aspect-video rounded-lg bg-[var(--color-bg-tertiary)] mb-3 overflow-hidden relative">
        {brief.thumbnailUrl ? (
          <img
            src={brief.thumbnailUrl}
            alt={brief.title}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
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
          {brief.title}
        </h3>
      </div>

      {/* Footer area - anchored to bottom */}
      <div className="mt-auto pt-2">
        {/* Tags row - only if tags exist */}
        {brief.tags && brief.tags.length > 0 && (
          <div className="flex items-center gap-1.5 mb-2 overflow-hidden">
            {brief.tags.slice(0, 3).map((tag) => (
              <TagBadge key={tag.id} name={tag.name} size="sm" active={activeTags?.includes(tag.name)} onClick={onTagClick ? () => onTagClick(tag.name) : undefined} />
            ))}
            {brief.tags.length > 3 && (
              <span className="text-xs text-[var(--color-text-tertiary)] shrink-0">
                +{brief.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Channel + date */}
        <div className="flex items-center justify-between text-sm border-t border-[var(--color-border)] pt-2">
          <span className="text-[var(--color-text-secondary)] truncate min-w-0">
            {brief.channelName}
          </span>
          <span className="text-[var(--color-text-secondary)] shrink-0 ml-2">
            {createdDate}
          </span>
        </div>
      </div>
    </Link>
  );
}
