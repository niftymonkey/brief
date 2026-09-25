import { Supadata, SupadataError } from "@supadata/js";
import { z } from "zod";
import { decodeHtmlEntities } from "../text";
import type { SourceOutcome, TranscriptSource } from "./types";

const ChunkSchema = z.object({
  text: z.string(),
  offset: z.number(),
  duration: z.number(),
  lang: z.string(),
});

const InlineTranscriptSchema = z.object({
  content: z.array(ChunkSchema),
  lang: z.string(),
  availableLangs: z.array(z.string()),
});

const JobIdSchema = z.object({ jobId: z.string() });

const ResponseSchema = z.union([InlineTranscriptSchema, JobIdSchema]);

const DEFAULT_RETRY_AFTER_SECONDS = 90;

export interface SupadataSourceOptions {
  lang?: string;
}

export class SupadataSource implements TranscriptSource {
  readonly name = "supadata" as const;
  private readonly client: Supadata;
  private readonly lang: string | undefined;

  constructor(apiKey: string, opts: SupadataSourceOptions = {}) {
    this.client = new Supadata({ apiKey });
    this.lang = opts.lang;
  }

  async fetch(videoId: string): Promise<SourceOutcome> {
    let raw: unknown;
    try {
      raw = await this.client.transcript({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        mode: "auto",
        ...(this.lang ? { lang: this.lang } : {}),
      });
    } catch (err) {
      return mapError(err);
    }

    const parsed = ResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return { kind: "transient", cause: "schema-mismatch" };
    }

    if ("jobId" in parsed.data) {
      return {
        kind: "pending",
        jobId: parsed.data.jobId,
        retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
      };
    }

    // Supadata answers a missing language with the first one it has, so a
    // mismatch here means the requested language is not on offer.
    if (this.lang && !sameLanguage(this.lang, parsed.data.lang)) {
      return {
        kind: "unavailable",
        reason: "language-unavailable",
        availableLangs: parsed.data.availableLangs,
      };
    }

    const entries = parsed.data.content.map((c) => ({
      text: decodeHtmlEntities(c.text),
      offsetSec: c.offset / 1000,
      durationSec: c.duration / 1000,
      lang: c.lang,
    }));

    return { kind: "ok", lang: parsed.data.lang, entries };
  }
}

function sameLanguage(requested: string, returned: string): boolean {
  const primary = (code: string) => code.split("-")[0]!.toLowerCase();
  return primary(requested) === primary(returned);
}

function mapError(err: unknown): SourceOutcome {
  if (err instanceof SupadataError) {
    switch (err.error) {
      case "transcript-unavailable":
        return { kind: "unavailable", reason: "no-captions" };
      case "not-found":
        return { kind: "unavailable", reason: "video-removed" };
      case "invalid-request":
        return { kind: "unavailable", reason: "invalid-id" };
      case "limit-exceeded":
        return { kind: "transient", cause: "limit-exceeded" };
      case "upgrade-required":
        return { kind: "transient", cause: "upgrade-required" };
      case "unauthorized":
        return { kind: "transient", cause: "unauthorized" };
      case "internal-error":
        return { kind: "transient", cause: "internal-error" };
    }
  }
  const cause = err instanceof Error ? err.message : "unknown";
  return { kind: "transient", cause };
}
