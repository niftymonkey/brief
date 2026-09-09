/** One channel a person added by hand, ready for `addTopicChannel`. */
export interface TopicChannelInputValue {
  youtubeChannelId: string;
  channelUrl: string;
  channelTitle: string | null;
}

export type ParsedTopicChannelInput =
  | { ok: true; value: TopicChannelInputValue }
  | { ok: false; error: string };

/**
 * A YouTube channel id: `UC` and 22 more characters of the URL-safe alphabet.
 * Anchored, so a string that merely starts like one is not mistaken for one.
 */
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * Whether a string is a YouTube channel id. The Server Actions check this on
 * their own input rather than trusting the form that produced it, and a bulk
 * import checks it per row, where there is no URL to parse and no title to
 * canonicalise.
 */
export function isYoutubeChannelId(value: string): boolean {
  return CHANNEL_ID_PATTERN.test(value);
}

/** The `/channel/<id>` segment of a channel URL, whatever follows it. */
const CHANNEL_URL_PATTERN = /youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})(?:[/?#]|$)/;

/** A handle or a legacy custom URL: a name YouTube resolves, not an id it stores. */
const NAMED_CHANNEL_PATTERN = /(?:^@|youtube\.com\/(?:@|c\/|user\/))/;

const HANDLE_HELP =
  "That names a channel by its handle, which is not its channel ID. Open the channel on YouTube, then About, then Share channel, then Copy channel ID, and paste that here.";

function toTitle(rawTitle: string): string | null {
  const title = rawTitle.trim();
  return title === "" ? null : title;
}

/**
 * Reads the box a person pastes a channel into: either the channel id itself or a
 * `/channel/<id>` URL. A handle gets a message pointing at where the id lives,
 * because resolving one needs a YouTube API call this form does not make.
 */
export function parseTopicChannelInput(raw: string, rawTitle: string): ParsedTopicChannelInput {
  const text = raw.trim();
  if (text === "") {
    return { ok: false, error: "Paste a channel ID or a youtube.com/channel/... URL." };
  }

  const fromUrl = CHANNEL_URL_PATTERN.exec(text);
  const youtubeChannelId = isYoutubeChannelId(text) ? text : fromUrl?.[1];

  if (youtubeChannelId === undefined) {
    if (NAMED_CHANNEL_PATTERN.test(text)) {
      return { ok: false, error: HANDLE_HELP };
    }
    return {
      ok: false,
      error:
        "That is not a channel ID or a channel URL. A channel ID starts with UC and is 24 characters long.",
    };
  }

  return {
    ok: true,
    value: {
      youtubeChannelId,
      channelUrl: `https://www.youtube.com/channel/${youtubeChannelId}`,
      channelTitle: toTitle(rawTitle),
    },
  };
}
