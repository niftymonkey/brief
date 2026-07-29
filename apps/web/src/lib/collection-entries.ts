import { formatSeconds } from "./collection-item-input";

/**
 * What the app knows about the video an entry points at, gathered from the
 * viewer's own briefs. Every field is optional knowledge: a collection may hold
 * a video that has never been briefed, in which case none of it is available.
 */
export interface EntryVideoFacts {
  title: string | null;
  channelName: string | null;
  durationSec: number | null;
}

/** The parts of a stored collection item the sitting is computed from. */
export interface SittingItem {
  id: string;
  videoId: string;
  startSec: number | null;
  endSec: number | null;
  videoTitle: string | null;
  /**
   * The video's frame shape as width divided by height, or null when the shape
   * was never resolved. Null is not a shape: readers pass it through
   * `entryAspectRatio` to get the one they draw.
   */
  aspectRatio: number | null;
}

/**
 * One entry as the page renders it: its place in the sitting, its own framing,
 * and the links it offers.
 */
export interface CollectionEntry {
  id: string;
  /** 1-based place in the collection, shown as the numeral. */
  ordinal: number;
  /** Anchor the transport track links to. */
  anchorId: string;
  videoId: string;
  title: string;
  channelName: string | null;
  startSec: number | null;
  endSec: number | null;
  /** Playable length in seconds, null when the video's own length is unknown. */
  durationSec: number | null;
  /** Where this entry begins in the sitting, null once an earlier length is unknown. */
  offsetSec: number | null;
  /** The mono source line's range phrase. */
  rangeLabel: string;
  /** Whether the entry is the whole video or a clip out of it. */
  kindLabel: string;
  /** The video's frame shape as width divided by height, null when unknown. */
  aspectRatio: number | null;
  watchUrl: string;
  thumbnailUrl: string;
  /** The still to try when `thumbnailUrl` does not load, null when there is none. */
  thumbnailFallbackUrl: string | null;
}

/**
 * A collection read as one continuous sitting: the entries in order, plus the
 * runtime facts the transport hero needs. `runtimeComplete` is false whenever any
 * entry's length is unknown, and the hero uses it to keep quiet rather than draw a
 * proportional track that would misstate the shape of the sitting.
 */
export interface CollectionSitting {
  entries: CollectionEntry[];
  totalRuntimeSec: number | null;
  runtimeComplete: boolean;
}

function entryDurationSec(
  startSec: number | null,
  endSec: number | null,
  videoDurationSec: number | null,
): number | null {
  const start = startSec ?? 0;
  const end = endSec === null ? videoDurationSec : Math.min(endSec, videoDurationSec ?? endSec);
  if (end === null) return null;
  return Math.max(0, end - start);
}

function entryRangeLabel(startSec: number | null, endSec: number | null): string {
  if (startSec !== null && endSec !== null) {
    return `${formatSeconds(startSec)} to ${formatSeconds(endSec)}`;
  }
  if (startSec !== null) return `from ${formatSeconds(startSec)}`;
  if (endSec !== null) return `to ${formatSeconds(endSec)}`;
  return "full clip";
}

function watchUrl(videoId: string, startSec: number | null): string {
  const base = `https://youtube.com/watch?v=${videoId}`;
  return startSec !== null ? `${base}&t=${startSec}s` : base;
}

/** The shape an entry is drawn at when its own was never resolved. */
export const DEFAULT_ASPECT_RATIO = 16 / 9;

/**
 * The shape to draw an entry's frame at: the video's own where it is known, and
 * 16:9 where it is not.
 *
 * Null is the ordinary case for an entry stored before the shape was ever looked
 * up, and for a video whose dimensions YouTube does not report, so this is what
 * keeps such an entry rendering exactly as it did when every entry was 16:9. A
 * non-positive ratio describes no frame that can be drawn and reads as unknown
 * for the same reason.
 */
export function entryAspectRatio(aspectRatio: number | null): number {
  return aspectRatio !== null && aspectRatio > 0 ? aspectRatio : DEFAULT_ASPECT_RATIO;
}

/**
 * Whether an entry is taller than it is wide, which is the case the page lays out
 * differently. 4:3 is not: it is a narrower landscape frame and is drawn as one.
 */
export function isVerticalAspectRatio(aspectRatio: number | null): boolean {
  return entryAspectRatio(aspectRatio) < 1;
}

function landscapeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

/** The still an entry's row shows, and the still to try if it does not load. */
export interface EntryThumbnail {
  url: string;
  fallbackUrl: string | null;
}

/**
 * Chooses the still for an entry's row by the shape of the video behind it.
 *
 * `mqdefault.jpg` is a 320x180 landscape JPEG whatever the video's shape, so a
 * vertical video arrives with blurred pillarbox panels baked into the pixels and
 * only its middle third is the real frame. `frame0.jpg` is the same still at the
 * video's own shape (268x480 for a vertical Short, 480x268 for a landscape
 * upload, around 20KB either way), which is what a 9:16 box wants.
 *
 * Both ytimg paths are undocumented, so a vertical entry names `mqdefault.jpg`
 * as its fallback and the row steps down to it when the native frame does not
 * load: cropped to 9:16 it lands on the middle of the same image, which is the
 * real frame with the blurred panels cropped away. Should that fail too the row
 * shows its plain placeholder. A landscape entry has no fallback because
 * `mqdefault.jpg` is already what it asks for.
 */
export function entryThumbnail(videoId: string, aspectRatio: number | null): EntryThumbnail {
  if (!isVerticalAspectRatio(aspectRatio)) {
    return { url: landscapeThumbnailUrl(videoId), fallbackUrl: null };
  }
  return {
    url: `https://i.ytimg.com/vi/${videoId}/frame0.jpg`,
    fallbackUrl: landscapeThumbnailUrl(videoId),
  };
}

/**
 * Spells a runtime out in words for the transport hero, where it reads as prose
 * rather than as a clock ("32 min 56 sec", "1 hr 4 min").
 */
export function formatRuntimeWords(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes} min ${seconds} sec` : `${minutes} min`;
  }
  return `${seconds} sec`;
}

/** The anchor a track segment links to, and the id its entry carries. */
export function entryAnchorId(ordinal: number): string {
  return `entry-${ordinal}`;
}

/**
 * Names the entry the transport draws as active, given the id of the collection
 * item the player currently sits on.
 *
 * The player reports an item id while the transport and the track speak in entry
 * ids. They are the same identifier read at two layers, because `buildSitting`
 * carries `item.id` through as `entry.id`; this function is where that identity
 * is asserted rather than assumed. It resolves to null whenever nothing is
 * playing or the reported item is no longer part of the sitting, so a removed or
 * swapped-out entry can never leave a stale segment lit.
 */
export function resolveActiveEntryId(
  entries: CollectionEntry[],
  playingItemId: string | null,
): string | null {
  if (playingItemId === null) return null;
  return entries.some((entry) => entry.id === playingItemId) ? playingItemId : null;
}

/** Whether the track draws this entry's segment filled. */
export function isEntryActive(entry: CollectionEntry, activeEntryId: string | null): boolean {
  return activeEntryId !== null && entry.id === activeEntryId;
}

/**
 * Reads an ordered list of collection items as a sitting, resolving each entry's
 * length and start position from the item's own bounds first and the video's
 * length second.
 */
export function buildSitting(
  items: SittingItem[],
  facts: Record<string, EntryVideoFacts>,
): CollectionSitting {
  let running = 0;
  let offsetsKnown = true;
  let allDurationsKnown = items.length > 0;

  const entries = items.map((item, index): CollectionEntry => {
    const videoFacts = facts[item.videoId] ?? null;
    const durationSec = entryDurationSec(
      item.startSec,
      item.endSec,
      videoFacts?.durationSec ?? null,
    );
    const offsetSec = offsetsKnown ? running : null;

    if (durationSec === null) {
      offsetsKnown = false;
      allDurationsKnown = false;
    } else {
      running += durationSec;
    }

    const ordinal = index + 1;
    const thumbnail = entryThumbnail(item.videoId, item.aspectRatio);
    return {
      id: item.id,
      ordinal,
      anchorId: entryAnchorId(ordinal),
      videoId: item.videoId,
      title: item.videoTitle ?? videoFacts?.title ?? item.videoId,
      channelName: videoFacts?.channelName ?? null,
      startSec: item.startSec,
      endSec: item.endSec,
      durationSec,
      offsetSec,
      rangeLabel: entryRangeLabel(item.startSec, item.endSec),
      kindLabel: item.startSec === null && item.endSec === null ? "Full video" : "Clip",
      aspectRatio: item.aspectRatio,
      watchUrl: watchUrl(item.videoId, item.startSec),
      thumbnailUrl: thumbnail.url,
      thumbnailFallbackUrl: thumbnail.fallbackUrl,
    };
  });

  return {
    entries,
    totalRuntimeSec: allDurationsKnown ? running : null,
    runtimeComplete: allDurationsKnown,
  };
}
