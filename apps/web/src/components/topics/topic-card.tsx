import Link from "next/link";
import { Radar } from "lucide-react";
import type { Topic } from "@/lib/topics";

interface TopicCardProps {
  topic: Topic;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function TopicCard({ topic }: TopicCardProps) {
  return (
    <Link
      href={`/topics/${topic.slug}`}
      className="group flex flex-col p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:shadow-[var(--shadow-md)] transition-all"
    >
      <div className="flex items-start gap-2 mb-2">
        <Radar className="w-4 h-4 mt-1 shrink-0 text-[var(--color-text-tertiary)]" />
        <h3 className="flex-1 min-w-0 font-medium text-[var(--color-text-primary)] line-clamp-2 leading-snug group-hover:text-[var(--color-accent)] transition-colors">
          {topic.name}
        </h3>
        {!topic.isActive && (
          <span className="shrink-0 mt-0.5 text-xs text-[var(--color-text-tertiary)]">Paused</span>
        )}
      </div>

      <div className="flex-1 min-h-[2.5rem]">
        {topic.interests ? (
          <p className="text-sm text-[var(--color-text-secondary)] line-clamp-3">
            {topic.interests}
          </p>
        ) : (
          <p className="text-sm text-[var(--color-text-tertiary)] italic">
            No interests described yet
          </p>
        )}
      </div>

      <div className="mt-auto pt-2 text-sm border-t border-[var(--color-border)] text-[var(--color-text-secondary)]">
        {countLabel(topic.channelCount, "channel", "channels")},{" "}
        {countLabel(topic.queryCount, "search", "searches")}
      </div>
    </Link>
  );
}
