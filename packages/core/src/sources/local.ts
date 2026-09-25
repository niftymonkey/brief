import {
  fetchTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptInvalidVideoIdError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
} from "youtube-transcript-plus";
import { z } from "zod";
import { decodeHtmlEntities } from "../text";
import { preferOriginalCaptionTrack } from "./original-track";
import type { SourceOutcome, TranscriptSource } from "./types";

const ResponseSchema = z.array(
  z.object({
    text: z.string(),
    offset: z.number(),
    duration: z.number(),
    lang: z.string().optional(),
  })
);

interface PlayerFetchParams {
  url: string;
  lang?: string;
  userAgent?: string;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}

export interface LocalSourceOptions {
  lang?: string;
}

export class LocalSource implements TranscriptSource {
  readonly name = "youtube-transcript-plus" as const;
  private readonly lang: string | undefined;

  constructor(opts: LocalSourceOptions = {}) {
    this.lang = opts.lang;
  }

  async fetch(videoId: string): Promise<SourceOutcome> {
    let languages: string[] = [];
    const playerFetch = async (params: PlayerFetchParams) => {
      const res = await fetch(params.url, {
        method: params.method ?? "GET",
        headers: {
          ...(params.userAgent ? { "User-Agent": params.userAgent } : {}),
          ...(params.lang ? { "Accept-Language": params.lang } : {}),
          ...params.headers,
        },
        ...(params.body ? { body: params.body } : {}),
      });
      if (!res.ok) return res;
      const preferred = preferOriginalCaptionTrack(await res.json());
      languages = preferred.languages;
      return new Response(JSON.stringify(preferred.player), {
        status: res.status,
        headers: res.headers,
      });
    };

    let raw: unknown;
    try {
      raw = await fetchTranscript(videoId, {
        ...(this.lang ? { lang: this.lang } : {}),
        playerFetch,
      });
    } catch (err) {
      if (err instanceof YoutubeTranscriptNotAvailableLanguageError) {
        return {
          kind: "unavailable",
          reason: "language-unavailable",
          availableLangs: languages,
        };
      }
      return mapError(err);
    }

    const parsed = ResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return { kind: "transient", cause: "schema-mismatch" };
    }

    const entries = parsed.data.map((e) => ({
      text: decodeHtmlEntities(e.text),
      offsetSec: e.offset,
      durationSec: e.duration,
      ...(e.lang ? { lang: e.lang } : {}),
    }));
    const lang = parsed.data[0]?.lang;

    return { kind: "ok", ...(lang ? { lang } : {}), entries };
  }
}

function mapError(err: unknown): SourceOutcome {
  if (
    err instanceof YoutubeTranscriptDisabledError ||
    err instanceof YoutubeTranscriptNotAvailableError
  ) {
    return { kind: "unavailable", reason: "no-captions" };
  }
  if (err instanceof YoutubeTranscriptVideoUnavailableError) {
    return { kind: "unavailable", reason: "video-removed" };
  }
  if (err instanceof YoutubeTranscriptInvalidVideoIdError) {
    return { kind: "unavailable", reason: "invalid-id" };
  }
  if (err instanceof YoutubeTranscriptTooManyRequestError) {
    return { kind: "transient", cause: "rate-limit" };
  }
  const cause = err instanceof Error ? err.message : "unknown";
  return { kind: "transient", cause };
}
