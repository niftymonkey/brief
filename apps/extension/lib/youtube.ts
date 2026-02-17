/** Extract YouTube video ID from a URL, or null if not a video page. */
export function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname === "www.youtube.com" ||
      parsed.hostname === "youtube.com" ||
      parsed.hostname === "m.youtube.com"
    ) {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v");
      }
      // /shorts/VIDEO_ID
      const shortsMatch = parsed.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]+)/);
      if (shortsMatch) return shortsMatch[1];
    }
    if (parsed.hostname === "youtu.be") {
      const id = parsed.pathname.split("/")[1];
      return id || null;
    }
  } catch {
    // invalid URL
  }
  return null;
}
