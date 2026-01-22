"use client";

import { useState, useCallback, type ReactNode } from "react";
import { YouTubePlayer } from "./youtube-player";
import { ChapterGrid } from "./chapter-grid";
import type { ContentSection } from "@/lib/types";

interface DigestViewerProps {
  videoId: string;
  title: string;
  sections: ContentSection[];
  hasCreatorChapters?: boolean | null;
  children?: ReactNode;
}

export function DigestViewer({
  videoId,
  title,
  sections,
  hasCreatorChapters,
  children,
}: DigestViewerProps) {
  const [seekToFn, setSeekToFn] = useState<((seconds: number) => void) | null>(null);

  const handlePlayerReady = useCallback((seekFn: (seconds: number) => void) => {
    setSeekToFn(() => seekFn);
  }, []);

  const handleSeek = useCallback((seconds: number) => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    seekToFn?.(seconds);
  }, [seekToFn]);

  return (
    <>
      <YouTubePlayer
        videoId={videoId}
        title={title}
        className="mb-4"
        onReady={handlePlayerReady}
      />
      {children}
      <section className="mt-6 mb-4">
        <ChapterGrid
          sections={sections}
          videoId={videoId}
          hasCreatorChapters={hasCreatorChapters}
          onSeek={seekToFn ? handleSeek : undefined}
        />
      </section>
    </>
  );
}
