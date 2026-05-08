import { describe, expect, it } from "vitest";
import { render, type CombinedResult } from "./renderer";
import type {
  MetadataResult,
  TranscriptResult,
  VideoMetadata,
} from "@brief/core";

const okTranscript: TranscriptResult = {
  kind: "ok",
  source: "youtube-transcript-plus",
  lang: "en",
  entries: [
    { offsetSec: 0, durationSec: 2, text: "hello" },
    { offsetSec: 2, durationSec: 1, text: "world" },
  ],
};

const pendingTranscript: TranscriptResult = {
  kind: "pending",
  source: "supadata",
  jobId: "abc",
  retryAfterSeconds: 90,
  message: "queued",
};

const unavailableTranscript: TranscriptResult = {
  kind: "unavailable",
  reason: "no-captions",
  message: "no captions",
};

const transientTranscript: TranscriptResult = {
  kind: "transient",
  cause: "net",
  message: "net error",
};

const metadata: VideoMetadata = {
  videoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
  channelTitle: "Rick Astley",
  channelId: "UC1",
  duration: "PT3M33S",
  publishedAt: "2009-10-25T07:57:33Z",
  description: "x",
};

const okMetadata: MetadataResult = { kind: "ok", metadata };

function combined(
  transcript: TranscriptResult,
  metadataResult: MetadataResult | null
): CombinedResult {
  return {
    videoIdOrUrl: "dQw4w9WgXcQ",
    transcript,
    metadata: metadataResult,
  };
}

describe("render — human format", () => {
  it("renders ok with metadata: header on stderr, transcript on stdout", () => {
    const out = render(combined(okTranscript, okMetadata), "human", false);
    expect(out.stdout).toBe("hello world\n");
    expect(out.stderr).toContain("Title: Never Gonna Give You Up");
    expect(out.stderr).toContain("Channel: Rick Astley");
    expect(out.stderr).toContain("Duration: PT3M33S");
    expect(out.stderr).toContain("Video ID: dQw4w9WgXcQ");
  });

  it("renders ok without metadata: bare header with just video id and url", () => {
    const out = render(combined(okTranscript, null), "human", false);
    expect(out.stdout).toBe("hello world\n");
    expect(out.stderr).toContain("Video ID: dQw4w9WgXcQ");
    expect(out.stderr).not.toContain("Title:");
    expect(out.stderr).not.toContain("Channel:");
  });

  it("renders pending: empty stdout, message on stderr", () => {
    const out = render(combined(pendingTranscript, null), "human", false);
    expect(out.stdout).toBe("");
    expect(out.stderr).toContain("Transcript generation queued");
    expect(out.stderr).toContain("abc");
    expect(out.stderr).toContain("90");
  });

  it("renders unavailable: empty stdout, reason on stderr", () => {
    const out = render(combined(unavailableTranscript, null), "human", false);
    expect(out.stdout).toBe("");
    expect(out.stderr).toContain("Unavailable");
    expect(out.stderr).toContain("no-captions");
  });

  it("renders transient: empty stdout, cause on stderr", () => {
    const out = render(combined(transientTranscript, null), "human", false);
    expect(out.stdout).toBe("");
    expect(out.stderr).toContain("Transient");
    expect(out.stderr).toContain("net");
  });

  it("does not emit ANSI when isTTY is false", () => {
    const out = render(combined(okTranscript, okMetadata), "human", false);
    // eslint-disable-next-line no-control-regex
    expect(out.stderr).not.toMatch(/\x1b\[/);
  });

  it("never emits ANSI on stdout even when isTTY is true", () => {
    const out = render(combined(okTranscript, okMetadata), "human", true);
    // eslint-disable-next-line no-control-regex
    expect(out.stdout).not.toMatch(/\x1b\[/);
  });
});

describe("render — json format", () => {
  it("emits a JSON object on stdout, empty stderr", () => {
    const out = render(combined(okTranscript, okMetadata), "json", false);
    expect(out.stderr).toBe("");
    const parsed = JSON.parse(out.stdout);
    expect(parsed.schemaVersion).toBe("1.0.0");
    expect(parsed.status).toBe("ok");
  });

  it("enriches the video object with metadata fields when metadata is ok", () => {
    const out = render(combined(okTranscript, okMetadata), "json", false);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.video).toEqual({
      id: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      channel: "Rick Astley",
      duration: "PT3M33S",
      publishedAt: "2009-10-25T07:57:33Z",
    });
  });

  it("emits a minimal video object when metadata is null", () => {
    const out = render(combined(okTranscript, null), "json", false);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.video).toEqual({
      id: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });

  it("renders pending status with job and source", () => {
    const out = render(combined(pendingTranscript, null), "json", false);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.status).toBe("pending");
    expect(parsed.source).toBe("supadata");
    expect(parsed.job).toEqual({ id: "abc", retryAfterSeconds: 90 });
  });

  it("renders unavailable with reason", () => {
    const out = render(combined(unavailableTranscript, null), "json", false);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.status).toBe("unavailable");
    expect(parsed.reason).toBe("no-captions");
  });

  it("uses videoIdOrUrl as the URL when input is already a URL", () => {
    const c = {
      videoIdOrUrl: "https://youtu.be/dQw4w9WgXcQ",
      transcript: okTranscript,
      metadata: null,
    };
    const out = render(c, "json", false);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.video.url).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(parsed.video.id).toBe("dQw4w9WgXcQ");
  });
});
