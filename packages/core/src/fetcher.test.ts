import { describe, expect, it, vi } from "vitest";
import { fetchTranscript } from "./fetcher";
import type { SourceOutcome, TranscriptSource } from "./sources/types";
import type {
  SourceName,
  TranscriptCache,
  TranscriptResult,
} from "./types";

vi.mock("./sources/local", () => ({
  LocalSource: class {
    readonly name = "youtube-transcript-plus" as const;
    fetch = localFetch;
  },
}));
vi.mock("./sources/supadata", () => ({
  SupadataSource: class {
    constructor(_key: string) {
      void _key;
    }
    readonly name = "supadata" as const;
    fetch = supadataFetch;
  },
}));

const localFetch = vi.fn<(...args: unknown[]) => Promise<SourceOutcome>>();
const supadataFetch = vi.fn<(...args: unknown[]) => Promise<SourceOutcome>>();

function reset() {
  localFetch.mockReset();
  supadataFetch.mockReset();
}

const noRetry = { maxAttempts: 1, initialDelayMs: 0, backoffMultiplier: 1 };

const VID = "dQw4w9WgXcQ";

describe("fetchTranscript cascade", () => {
  it("returns ok from src1 immediately, not calling src2", async () => {
    reset();
    localFetch.mockResolvedValue({ kind: "ok", entries: [], lang: "en" });
    supadataFetch.mockResolvedValue({ kind: "ok", entries: [] });

    const result = await fetchTranscript(VID, {
      supadataApiKey: "key",
      retryPolicy: noRetry,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.source).toBe("youtube-transcript-plus");
    }
    expect(localFetch).toHaveBeenCalledTimes(1);
    expect(supadataFetch).not.toHaveBeenCalled();
  });

  it("returns pending from src1 immediately (short-circuits)", async () => {
    reset();
    localFetch.mockResolvedValue({
      kind: "pending",
      jobId: "j",
      retryAfterSeconds: 90,
    } as SourceOutcome);
    supadataFetch.mockResolvedValue({ kind: "ok", entries: [] });

    const result = await fetchTranscript(VID, {
      supadataApiKey: "key",
      retryPolicy: noRetry,
    });

    expect(result.kind).toBe("pending");
    expect(supadataFetch).not.toHaveBeenCalled();
  });

  it("falls through unavailable→ok and returns src2", async () => {
    reset();
    localFetch.mockResolvedValue({ kind: "unavailable", reason: "no-captions" });
    supadataFetch.mockResolvedValue({ kind: "ok", entries: [], lang: "en" });

    const result = await fetchTranscript(VID, {
      supadataApiKey: "key",
      retryPolicy: noRetry,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.source).toBe("supadata");
  });

  it("falls through transient→ok and returns src2", async () => {
    reset();
    localFetch.mockResolvedValue({ kind: "transient", cause: "net" });
    supadataFetch.mockResolvedValue({ kind: "ok", entries: [], lang: "en" });

    const result = await fetchTranscript(VID, {
      supadataApiKey: "key",
      retryPolicy: noRetry,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.source).toBe("supadata");
  });

  it("prefers later unavailable over earlier transient (more informative)", async () => {
    reset();
    localFetch.mockResolvedValue({ kind: "transient", cause: "net" });
    supadataFetch.mockResolvedValue({
      kind: "unavailable",
      reason: "no-captions",
    });

    const result = await fetchTranscript(VID, {
      supadataApiKey: "key",
      retryPolicy: noRetry,
    });

    expect(result.kind).toBe("unavailable");
    if (result.kind === "unavailable") expect(result.reason).toBe("no-captions");
  });

  it("keeps earlier unavailable when later returns transient", async () => {
    reset();
    localFetch.mockResolvedValue({
      kind: "unavailable",
      reason: "no-captions",
    });
    supadataFetch.mockResolvedValue({ kind: "transient", cause: "net" });

    const result = await fetchTranscript(VID, {
      supadataApiKey: "key",
      retryPolicy: noRetry,
    });

    expect(result.kind).toBe("unavailable");
    if (result.kind === "unavailable") expect(result.reason).toBe("no-captions");
  });

  it("returns transient when only transient outcomes seen", async () => {
    reset();
    localFetch.mockResolvedValue({ kind: "transient", cause: "n1" });
    supadataFetch.mockResolvedValue({ kind: "transient", cause: "n2" });

    const result = await fetchTranscript(VID, {
      supadataApiKey: "key",
      retryPolicy: noRetry,
    });

    expect(result.kind).toBe("transient");
  });

  it("returns last unavailable when both are unavailable", async () => {
    reset();
    localFetch.mockResolvedValue({ kind: "unavailable", reason: "no-captions" });
    supadataFetch.mockResolvedValue({
      kind: "unavailable",
      reason: "video-removed",
    });

    const result = await fetchTranscript(VID, {
      supadataApiKey: "key",
      retryPolicy: noRetry,
    });

    expect(result.kind).toBe("unavailable");
    if (result.kind === "unavailable") {
      expect(result.reason).toBe("video-removed");
    }
  });

  it("returns invalid-id when input does not parse, no source called", async () => {
    reset();
    const result = await fetchTranscript("not-a-video!!", {
      supadataApiKey: "key",
      retryPolicy: noRetry,
    });
    expect(result.kind).toBe("unavailable");
    if (result.kind === "unavailable") expect(result.reason).toBe("invalid-id");
    expect(localFetch).not.toHaveBeenCalled();
    expect(supadataFetch).not.toHaveBeenCalled();
  });

  it("skips Supadata when no apiKey is provided", async () => {
    reset();
    localFetch.mockResolvedValue({ kind: "transient", cause: "net" });

    const result = await fetchTranscript(VID, { retryPolicy: noRetry });

    expect(supadataFetch).not.toHaveBeenCalled();
    expect(result.kind).toBe("transient");
  });

  it("honors opts.sources override: only local", async () => {
    reset();
    localFetch.mockResolvedValue({ kind: "ok", entries: [] });

    await fetchTranscript(VID, {
      supadataApiKey: "key",
      sources: ["youtube-transcript-plus"],
      retryPolicy: noRetry,
    });

    expect(localFetch).toHaveBeenCalled();
    expect(supadataFetch).not.toHaveBeenCalled();
  });

  it("honors opts.sources override: only supadata", async () => {
    reset();
    supadataFetch.mockResolvedValue({ kind: "ok", entries: [] });

    await fetchTranscript(VID, {
      supadataApiKey: "key",
      sources: ["supadata"],
      retryPolicy: noRetry,
    });

    expect(supadataFetch).toHaveBeenCalled();
    expect(localFetch).not.toHaveBeenCalled();
  });

  it("returns transient: no-sources when sources resolve to empty (e.g. supadata-only without key)", async () => {
    reset();
    const result = await fetchTranscript(VID, {
      sources: ["supadata"] as SourceName[],
      retryPolicy: noRetry,
    });
    expect(result.kind).toBe("transient");
    if (result.kind === "transient") {
      expect(result.cause).toBe("no-sources");
    }
  });

  it("checks cache.get before cascade and returns cached result", async () => {
    reset();
    const cached: TranscriptResult = {
      kind: "ok",
      source: "youtube-transcript-plus",
      entries: [],
      lang: "en",
    };
    const cache: TranscriptCache = {
      get: vi.fn().mockResolvedValue(cached),
      set: vi.fn(),
    };

    const result = await fetchTranscript(VID, {
      supadataApiKey: "key",
      cache,
      retryPolicy: noRetry,
    });

    expect(result).toBe(cached);
    expect(cache.get).toHaveBeenCalledWith(VID);
    expect(localFetch).not.toHaveBeenCalled();
  });

  it("writes ok results to cache.set", async () => {
    reset();
    localFetch.mockResolvedValue({ kind: "ok", entries: [], lang: "en" });
    const cache: TranscriptCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const result = await fetchTranscript(VID, {
      supadataApiKey: "key",
      cache,
      retryPolicy: noRetry,
    });

    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(VID, result);
  });

  it("does not call cache.set on non-ok outcomes", async () => {
    reset();
    localFetch.mockResolvedValue({ kind: "transient", cause: "net" });
    supadataFetch.mockResolvedValue({ kind: "transient", cause: "net" });
    const cache: TranscriptCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };

    await fetchTranscript(VID, {
      supadataApiKey: "key",
      cache,
      retryPolicy: noRetry,
    });

    expect(cache.set).not.toHaveBeenCalled();
  });

  it("swallows cache.set errors and still returns the ok result", async () => {
    reset();
    localFetch.mockResolvedValue({ kind: "ok", entries: [], lang: "en" });
    const cache: TranscriptCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockRejectedValue(new Error("disk full")),
    };

    const result = await fetchTranscript(VID, {
      supadataApiKey: "key",
      cache,
      retryPolicy: noRetry,
    });

    expect(result.kind).toBe("ok");
  });

  it("returns transient: aborted when signal is already aborted", async () => {
    reset();
    const controller = new AbortController();
    controller.abort();

    const result = await fetchTranscript(VID, {
      supadataApiKey: "key",
      signal: controller.signal,
      retryPolicy: noRetry,
    });

    expect(result.kind).toBe("transient");
    if (result.kind === "transient") expect(result.cause).toBe("aborted");
    expect(localFetch).not.toHaveBeenCalled();
  });

  it("decorates ok with the source that succeeded", async () => {
    reset();
    localFetch.mockResolvedValue({
      kind: "ok",
      entries: [{ offsetSec: 1, durationSec: 1, text: "hi" }],
      lang: "en",
    });

    const result = await fetchTranscript(VID, { retryPolicy: noRetry });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.source).toBe("youtube-transcript-plus");
      expect(result.entries).toHaveLength(1);
      expect(result.lang).toBe("en");
    }
  });

  it("decorates pending with the source that returned it", async () => {
    reset();
    localFetch.mockResolvedValue({ kind: "unavailable", reason: "no-captions" });
    supadataFetch.mockResolvedValue({
      kind: "pending",
      jobId: "abc",
      retryAfterSeconds: 60,
    });

    const result = await fetchTranscript(VID, {
      supadataApiKey: "key",
      retryPolicy: noRetry,
    });

    expect(result.kind).toBe("pending");
    if (result.kind === "pending") {
      expect(result.source).toBe("supadata");
      expect(result.jobId).toBe("abc");
      expect(result.retryAfterSeconds).toBe(60);
    }
  });
});
