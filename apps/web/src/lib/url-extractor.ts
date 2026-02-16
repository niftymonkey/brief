/**
 * Extracts URLs from text
 *
 * @param text - Text to extract URLs from
 * @returns Array of unique URLs found in the text
 */
export function extractUrls(text: string): string[] {
  if (!text) return [];

  const urls: Set<string> = new Set();

  // Split by whitespace and newlines
  const tokens = text.split(/\s+/);

  for (const token of tokens) {
    // Try to parse as URL
    try {
      const url = new URL(token);
      // Only include http/https URLs
      if (url.protocol === "http:" || url.protocol === "https:") {
        urls.add(url.href);
      }
    } catch {
      // Not a valid URL, skip
    }

    // Also try removing common trailing punctuation
    const cleaned = token.replace(/[,;.!?)\]}>]+$/, "");
    if (cleaned !== token) {
      try {
        const url = new URL(cleaned);
        if (url.protocol === "http:" || url.protocol === "https:") {
          urls.add(url.href);
        }
      } catch {
        // Not a valid URL, skip
      }
    }
  }

  return Array.from(urls);
}

/**
 * Combines URLs from multiple sources and returns unique URLs
 */
export function combineUrls(...sources: (string | undefined)[]): string[] {
  const allUrls = new Set<string>();

  for (const source of sources) {
    if (source) {
      const urls = extractUrls(source);
      urls.forEach((url) => allUrls.add(url));
    }
  }

  return Array.from(allUrls);
}
