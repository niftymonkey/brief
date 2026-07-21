const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

const URL_PATTERNS: RegExp[] = [
  /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([^&\n?#]+)/,
  /^(?:https?:\/\/)?youtu\.be\/([^&\n?#]+)/,
  /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/embed\/([^&\n?#]+)/,
  /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/shorts\/([^&\n?#]+)/,
  /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/live\/([^&\n?#]+)/,
];

/** Extract YouTube video ID from a URL, or null if not a video page. */
export function extractVideoId(input: string): string | null {
  if (!input) return null;

  if (VIDEO_ID.test(input)) return input;

  for (const pattern of URL_PATTERNS) {
    const match = input.match(pattern);
    if (match?.[1] && VIDEO_ID.test(match[1])) {
      return match[1];
    }
  }

  return null;
}
