declare namespace YT {
  class Player {
    constructor(element: HTMLElement | string, options: PlayerOptions);
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    destroy(): void;
    getPlayerState(): PlayerState;
    getCurrentTime(): number;
    /** The loaded video's length in seconds, or 0 before its metadata arrives. */
    getDuration(): number;
    getVideoData(): VideoData;
    loadVideoById(options: LoadVideoOptions): void;
    cueVideoById(options: LoadVideoOptions): void;
    playVideo(): void;
    pauseVideo(): void;
    stopVideo(): void;
    mute(): void;
    unMute(): void;
  }

  interface VideoData {
    video_id?: string;
    title?: string;
  }

  interface LoadVideoOptions {
    videoId: string;
    startSeconds?: number;
    endSeconds?: number;
  }

  interface PlayerOptions {
    videoId?: string;
    width?: number | string;
    height?: number | string;
    playerVars?: PlayerVars;
    events?: PlayerEvents;
  }

  interface PlayerVars {
    autoplay?: 0 | 1;
    controls?: 0 | 1;
    enablejsapi?: 0 | 1;
    modestbranding?: 0 | 1;
    mute?: 0 | 1;
    playsinline?: 0 | 1;
    rel?: 0 | 1;
    origin?: string;
  }

  interface PlayerEvents {
    onReady?: (event: PlayerEvent) => void;
    onStateChange?: (event: OnStateChangeEvent) => void;
    onError?: (event: OnErrorEvent) => void;
    onAutoplayBlocked?: (event: PlayerEvent) => void;
  }

  interface PlayerEvent {
    target: Player;
  }

  interface OnStateChangeEvent extends PlayerEvent {
    data: PlayerState;
  }

  interface OnErrorEvent extends PlayerEvent {
    data: number;
  }

  enum PlayerState {
    UNSTARTED = -1,
    ENDED = 0,
    PLAYING = 1,
    PAUSED = 2,
    BUFFERING = 3,
    CUED = 5,
  }
}

interface Window {
  YT?: typeof YT;
  onYouTubeIframeAPIReady?: () => void;
}
