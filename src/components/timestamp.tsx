"use client";

import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

interface TimestampProps {
  time: string;
  videoId: string;
  className?: string;
}

/**
 * Parses a timestamp string (MM:SS or H:MM:SS) to seconds
 */
function parseTimestamp(timestamp: string): number {
  const parts = timestamp.split(":").map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

export function Timestamp({ time, videoId, className }: TimestampProps) {
  const seconds = parseTimestamp(time);
  const url = `https://youtube.com/watch?v=${videoId}&t=${seconds}s`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-sm",
        "text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]",
        "bg-[var(--color-accent-subtle)] px-2 py-0.5 rounded-md",
        "hover:bg-[var(--color-accent)]/20 transition-colors",
        "group",
        className
      )}
    >
      <Play className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      {time}
    </a>
  );
}
