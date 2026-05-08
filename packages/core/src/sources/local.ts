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
import type { SourceOutcome, TranscriptSource } from "./types";

const ResponseSchema = z.array(
  z.object({
    text: z.string(),
    offset: z.number(),
    duration: z.number(),
    lang: z.string().optional(),
  })
);

export class LocalSource implements TranscriptSource {
  readonly name = "youtube-transcript-plus" as const;

  async fetch(videoId: string): Promise<SourceOutcome> {
    let raw: unknown;
    try {
      raw = await fetchTranscript(videoId);
    } catch (err) {
      return mapError(err);
    }

    const parsed = ResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return { kind: "transient", cause: "schema-mismatch" };
    }

    const entries = parsed.data.map((e) => ({
      text: e.text,
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
    err instanceof YoutubeTranscriptNotAvailableError ||
    err instanceof YoutubeTranscriptNotAvailableLanguageError
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
