"use client";

import { useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

interface YouTubePlayerProps {
  videoId: string;
  title: string;
  className?: string;
  onReady?: (seekTo: (seconds: number) => void) => void;
}

let apiLoadPromise: Promise<void> | null = null;

function loadYouTubeAPI(): Promise<void> {
  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }

    const existingCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      existingCallback?.();
      resolve();
    };

    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }
  });

  return apiLoadPromise;
}

export function YouTubePlayer({ videoId, title, className, onReady }: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const onReadyRef = useRef(onReady);

  // Keep callback ref current
  onReadyRef.current = onReady;

  const seekTo = useCallback((seconds: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(seconds, true);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initPlayer() {
      if (!containerRef.current) return;

      await loadYouTubeAPI();

      if (!mounted || !containerRef.current) return;

      // Create a unique ID for this player instance
      const playerId = `youtube-player-${videoId}-${Date.now()}`;
      containerRef.current.id = playerId;

      playerRef.current = new YT.Player(playerId, {
        videoId,
        playerVars: {
          enablejsapi: 1,
          rel: 0,
        },
        events: {
          onReady: () => {
            if (mounted) {
              onReadyRef.current?.(seekTo);
            }
          },
        },
      });
    }

    initPlayer();

    return () => {
      mounted = false;
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [videoId, seekTo]);

  return (
    <div
      className={cn(
        "relative aspect-video rounded-2xl overflow-hidden bg-black",
        className
      )}
    >
      <div ref={containerRef} className="absolute inset-0 w-full h-full" title={title} />
    </div>
  );
}
