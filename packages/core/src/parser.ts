const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

const URL_PATTERNS: RegExp[] = [
  /(?:youtube\.com\/watch\?(?:[^#]*&)?v=)([^&\n?#]+)/,
  /(?:youtu\.be\/)([^&\n?#]+)/,
  /(?:m\.youtube\.com\/watch\?(?:[^#]*&)?v=)([^&\n?#]+)/,
  /(?:youtube\.com\/embed\/)([^&\n?#]+)/,
];

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
