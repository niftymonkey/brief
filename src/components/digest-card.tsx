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

      {/* Title */}
      <h3 className="font-medium text-[var(--color-text-primary)] line-clamp-2 group-hover:text-[var(--color-accent)] transition-colors mb-1">
        {digest.title}
      </h3>

      {/* Meta */}
      <p className="text-sm text-[var(--color-text-secondary)]">
        {digest.channelName}
      </p>
      <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
        {createdDate}
      </p>
    </Link>
  );
}
