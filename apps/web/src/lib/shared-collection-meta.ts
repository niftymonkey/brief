import { formatRuntimeWords, type CollectionSitting } from "./collection-entries";

/** Longest description a link unfurl will show before cutting it off itself. */
const UNFURL_DESCRIPTION_LIMIT = 160;

const ELLIPSIS = "...";

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Cuts `text` to `limit` characters, counting and slicing by code point so an
 * astral character (an emoji, say) that straddles the limit is dropped whole
 * rather than halved into a lone surrogate the served HTML would render as a
 * replacement character.
 */
function truncate(text: string, limit: number): string {
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  return characters.slice(0, limit - ELLIPSIS.length).join("") + ELLIPSIS;
}

function entryCountLabel(count: number): string {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

/**
 * The sentence a link unfurl shows for a shared collection. The curator's own
 * framing wins whenever they wrote one, flattened to a single line and cut to
 * the length an unfurl will show; otherwise the sitting describes itself, and
 * stays quiet about runtime when any entry's length is unknown.
 */
export function sharedCollectionDescription(
  description: string | null,
  sitting: CollectionSitting,
): string {
  const framing = description === null ? "" : collapseWhitespace(description);
  if (framing.length > 0) {
    return truncate(framing, UNFURL_DESCRIPTION_LIMIT);
  }

  const { entries, totalRuntimeSec } = sitting;
  if (entries.length === 0) {
    return "A collection on Brief.";
  }

  const count = entryCountLabel(entries.length);
  if (totalRuntimeSec === null) {
    return `${count} curated to play through in order.`;
  }
  return `${count}, ${formatRuntimeWords(totalRuntimeSec)}, curated to play through in order.`;
}

/**
 * The still a shared collection unfurls with, taken from its opening entry and
 * built on the same convention a shared brief uses. Null when the collection has
 * no entries to stand for it.
 */
export function unfurlThumbnailUrl(videoId: string | undefined): string | null {
  return videoId === undefined ? null : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}
