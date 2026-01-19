import Image from "next/image";
import Link from "next/link";
import type { DigestSummary } from "@/lib/types";

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
      className="group block p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:shadow-[var(--shadow-md)] transition-all"
    >
      {/* Thumbnail */}
      <div className="aspect-video rounded-lg bg-[var(--color-bg-tertiary)] mb-3 overflow-hidden relative">
        {digest.thumbnailUrl ? (
          <Image
            src={digest.thumbnailUrl}
            alt={digest.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--color-text-tertiary)]">
            No thumbnail
          </div>
        )}
      </div>

      {/* Title - FIXED HEIGHT for 2 lines */}
      <div className="h-[2.75rem] mb-2">
        <h3 className="font-medium text-[var(--color-text-primary)] line-clamp-2 leading-snug group-hover:text-[var(--color-accent)] transition-colors">
          {digest.title}
        </h3>
      </div>

      {/* Meta - channel left, date right */}
      <div className="flex items-center justify-between text-sm border-t border-[var(--color-border)] pt-2 mt-2">
        <span className="text-[var(--color-text-secondary)] truncate min-w-0">
          {digest.channelName}
        </span>
        <span className="text-[var(--color-text-tertiary)] text-xs shrink-0 ml-2">
          {createdDate}
        </span>
      </div>
    </Link>
  );
}
