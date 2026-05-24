import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DownloadAdapter } from "./download";
import { extractAllFrames, type FfmpegAdapter } from "./ffmpeg";
import { downsampleCandidates, selectCandidates, type Candidate } from "./selection";
import type { ClassifyResult, VisionClient, VisionMode } from "./vision";
import { weave } from "./weave";
import type {
  FramesFailReason,
  FramesMetrics,
  FramesOptions,
  FramesPhase,
  FramesResult,
} from "./types";

const DEFAULT_MAX_CANDIDATES = 250;
const SCENE_THRESHOLD = 0.2;
const CLASSIFIER_CONCURRENCY = 5;
const VISION_CONCURRENCY = 4;

/** Filename of the augmented transcript cache, written on a successful run. */
const AUGMENTED_CACHE_FILE = "augmented.txt";
/** Filename of the FramesMetrics blob, written alongside augmented.txt. */
const METRICS_CACHE_FILE = "metrics.json";
/**
 * Per-phase cache filenames. Each is written after its phase succeeds so a
 * subsequent run that aborts/fails downstream can skip the expensive work the
 * prior run already paid for. Cache invalidation: scenes is content-free so
 * it's reused unconditionally; classifications/vision tie reuse to the model
 * id captured at write time so swapping models discards the cached entries.
 */
const SCENES_CACHE_FILE = "scenes.json";
const CLASSIFICATIONS_CACHE_FILE = "classifications.json";
const VISION_CACHE_FILE = "vision.json";

interface ScenesCache {
  scenes: number[];
}
interface ClassificationsCache {
  classifierModel: string;
  entries: Record<string, ClassifyResult>;
}
interface VisionCacheEntry {
  description: string;
  mode: VisionMode;
  inputTokens: number;
  outputTokens: number;
}
interface VisionCache {
  visionModel: string;
  entries: Record<string, VisionCacheEntry>;
}

export interface FramesAdapters {
  download: DownloadAdapter;
  ffmpeg: FfmpegAdapter;
  vision: VisionClient;
}

/**
 * Sequences the 8-phase video-frames pipeline. Each phase reports failures as
 * a `FramesResult.attempted-failed` discriminator with a `phase` tag so the
 * caller knows which step regressed. Metrics accumulate as the run proceeds
 * and are returned on both success and failure paths.
 *
 * Adapters are injected so Phase 4's integration tests can stub the external
 * surfaces (yt-dlp, ffmpeg, OpenRouter) without touching real subprocesses or
 * the network.
 */
export async function runFramesPipeline(
  opts: FramesOptions,
  adapters: FramesAdapters,
): Promise<FramesResult> {
  const startedAt = Date.now();
  const maxCandidates = opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

  const metrics: FramesMetrics = {
    videoDurationSec: 0,
    candidatesGenerated: 0,
    candidatesAfterDedup: 0,
    classifierYes: 0,
    classifierNo: 0,
    visionCalls: 0,
    visionVerbatim: 0,
    visionSummary: 0,
    inputTokens: 0,
    outputTokens: 0,
    classifierModel: adapters.vision.classifierModel,
    visionModel: adapters.vision.visionModel,
    wallClockMs: 0,
    phasesMs: {},
    costSource: "cli-reported",
  };

  // Stopwatch for per-phase wall-clock attribution. The same span guard is used
  // in both the happy path and failure paths so a crashed phase still gets its
  // partial duration recorded in `phasesMs`.
  async function timePhase<T>(phase: FramesPhase, fn: () => Promise<T>): Promise<T> {
    const phaseStart = Date.now();
    try {
      return await fn();
    } finally {
      const prior = metrics.phasesMs[phase] ?? 0;
      metrics.phasesMs[phase] = prior + (Date.now() - phaseStart);
    }
  }

  const finalize = (
    failure: { reason: FramesFailReason; phase: FramesPhase; message: string } | null,
    transcriptOut?: string,
  ): FramesResult => {
    metrics.wallClockMs = Date.now() - startedAt;
    if (failure) {
      return {
        kind: "attempted-failed",
        reason: failure.reason,
        phase: failure.phase,
        message: failure.message,
        metrics,
      };
    }
    return { kind: "included", transcript: transcriptOut ?? "", metrics };
  };

  if (opts.signal?.aborted) {
    return finalize({ reason: "aborted", phase: "preflight", message: "Aborted before start." });
  }

  // Preflight: bail early if either local binary is missing so we don't spend
  // any time on a run that's guaranteed to fail at first subprocess.
  if (!adapters.download.isAvailable()) {
    return finalize({
      reason: "missing-system-dep",
      phase: "preflight",
      message: "Required CLI tool 'yt-dlp' not found on PATH. Install yt-dlp (https://github.com/yt-dlp/yt-dlp) and try again.",
    });
  }
  if (!adapters.ffmpeg.isAvailable()) {
    return finalize({
      reason: "missing-system-dep",
      phase: "preflight",
      message: "Required CLI tool 'ffmpeg' not found on PATH. Install ffmpeg (https://ffmpeg.org/) and try again.",
    });
  }

  mkdirSync(opts.workDir, { recursive: true });
  const framesDir = resolve(opts.workDir, "frames");
  mkdirSync(framesDir, { recursive: true });

  // ---------- cache hit short-circuit ----------
  // If a prior successful run wrote both augmented.txt and metrics.json into
  // this workDir, return them verbatim and skip every phase. Lets `brief ask`
  // feel near-instant on re-runs against the same videoId, and lets repeated
  // `generate --with-frames` runs ship accurate previously-recorded metrics
  // without re-spending classifier/vision tokens. Cache invalidation today is
  // manual: delete the workDir (or its augmented.txt) to force a fresh run.
  const augmentedPath = resolve(opts.workDir, AUGMENTED_CACHE_FILE);
  const metricsPath = resolve(opts.workDir, METRICS_CACHE_FILE);
  if (existsSync(augmentedPath) && existsSync(metricsPath)) {
    try {
      const cachedTranscript = readFileSync(augmentedPath, "utf-8");
      const cachedMetrics = JSON.parse(readFileSync(metricsPath, "utf-8")) as FramesMetrics;
      // Bypass the success cache when either model has changed since it was
      // produced. Mirrors the phase-cache invalidation pattern below so a
      // model swap never serves stale weave output. Falling through here
      // means we re-run, which will overwrite augmented.txt/metrics.json with
      // fresh output keyed to the current models.
      const modelsMatch =
        cachedMetrics.classifierModel === adapters.vision.classifierModel &&
        cachedMetrics.visionModel === adapters.vision.visionModel;
      if (modelsMatch) {
        // Refresh the wall-clock so a downstream consumer can tell this run
        // was cheap (a near-zero ms total signals "served from cache"). Per-
        // phase numbers stay at their original values from the producing run.
        const cacheRefreshedMetrics: FramesMetrics = {
          ...cachedMetrics,
          wallClockMs: Date.now() - startedAt,
        };
        return { kind: "included", transcript: cachedTranscript, metrics: cacheRefreshedMetrics };
      }
    } catch {
      // Cache files exist but are unreadable/malformed; fall through to a
      // fresh run rather than crashing. The fresh run will overwrite them.
    }
  }

  // ---------- phase: download ----------
  const downloadResult = await timePhase("download", () =>
    adapters.download.download(opts.videoId, opts.workDir),
  );
  if (downloadResult.kind === "failed") {
    return finalize({
      reason: downloadResult.reason,
      phase: "download",
      message: downloadResult.message,
    });
  }
  metrics.videoDurationSec = downloadResult.durationSec;

  if (opts.signal?.aborted) {
    return finalize({ reason: "aborted", phase: "download", message: "Aborted after download." });
  }

  // ---------- phase: scene-detection ----------
  let scenes: number[];
  const cachedScenes = readScenesCache(opts.workDir);
  if (cachedScenes) {
    scenes = cachedScenes;
  } else {
    try {
      scenes = await timePhase("scene-detection", () =>
        adapters.ffmpeg.detectScenes(downloadResult.videoPath, SCENE_THRESHOLD),
      );
    } catch (err) {
      return finalize({
        reason: "ffmpeg-failed",
        phase: "scene-detection",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    writeScenesCache(opts.workDir, scenes);
  }

  // ---------- phase: selection ----------
  const selection = await timePhase("selection", async () => {
    return selectCandidates({
      scenes,
      chapters: opts.chapters ?? [],
      transcript: opts.transcript,
      durationSec: downloadResult.durationSec,
    });
  });
  const { candidates: dedupedCandidates, candidatesGenerated } = selection;
  metrics.candidatesGenerated = candidatesGenerated;
  metrics.candidatesAfterDedup = dedupedCandidates.length;

  // If post-dedup count exceeds the budget, downsample to the cap rather than
  // failing the run. The `--with-frames` opt-in is expensive; silently demoting
  // to transcript-only defeats it. Tier-priority sampling keeps every chapter
  // start and transcript cue and thins scene-changes by even time spread.
  const candidates =
    dedupedCandidates.length > maxCandidates
      ? downsampleCandidates(dedupedCandidates, maxCandidates)
      : dedupedCandidates;
  if (candidates.length !== dedupedCandidates.length) {
    metrics.candidatesAfterDownsample = candidates.length;
  }

  if (opts.signal?.aborted) {
    return finalize({ reason: "aborted", phase: "selection", message: "Aborted before extraction." });
  }

  // ---------- phase: extraction ----------
  try {
    await timePhase("extraction", () =>
      extractAllFrames(candidates, downloadResult.videoPath, framesDir, adapters.ffmpeg),
    );
  } catch (err) {
    return finalize({
      reason: "ffmpeg-failed",
      phase: "extraction",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // ---------- phase: classify ----------
  const classifierCache = readClassificationsCache(opts.workDir, adapters.vision.classifierModel);
  try {
    await timePhase("classify", () =>
      runWithConcurrency(candidates, CLASSIFIER_CONCURRENCY, async (c) => {
        if (opts.signal?.aborted || !c.frame) return;
        const cached = classifierCache[c.frame];
        let result: ClassifyResult;
        if (cached) {
          result = cached;
        } else {
          result = await adapters.vision.classify(resolve(framesDir, c.frame), opts.signal);
          classifierCache[c.frame] = result;
          metrics.inputTokens += result.inputTokens;
          metrics.outputTokens += result.outputTokens;
        }
        c.classification = { verdict: result.verdict };
        if (result.verdict === "yes") metrics.classifierYes++;
        else metrics.classifierNo++;
      }),
    );
  } catch (err) {
    writeClassificationsCache(opts.workDir, adapters.vision.classifierModel, classifierCache);
    if (opts.signal?.aborted) {
      return finalize({ reason: "aborted", phase: "classify", message: "Aborted during classify." });
    }
    return finalize({
      reason: "vision-failed",
      phase: "classify",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  writeClassificationsCache(opts.workDir, adapters.vision.classifierModel, classifierCache);

  if (opts.signal?.aborted) {
    return finalize({ reason: "aborted", phase: "classify", message: "Aborted before vision pass." });
  }

  // ---------- phase: vision ----------
  const yesFrames = candidates.filter((c) => c.classification?.verdict === "yes");
  const visionCache = readVisionCache(opts.workDir, adapters.vision.visionModel);
  try {
    await timePhase("vision", () =>
      runWithConcurrency(yesFrames, VISION_CONCURRENCY, async (c) => {
        if (opts.signal?.aborted || !c.frame) return;
        const cached = visionCache[c.frame];
        let entry: VisionCacheEntry;
        if (cached) {
          entry = cached;
        } else {
          const result = await adapters.vision.describe(resolve(framesDir, c.frame), opts.signal);
          entry = {
            description: result.description,
            mode: result.mode,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
          };
          visionCache[c.frame] = entry;
          metrics.inputTokens += result.inputTokens;
          metrics.outputTokens += result.outputTokens;
        }
        c.vision = {
          description: entry.description,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
        };
        metrics.visionCalls++;
        if (entry.mode === "verbatim") metrics.visionVerbatim++;
        else metrics.visionSummary++;
      }),
    );
  } catch (err) {
    writeVisionCache(opts.workDir, adapters.vision.visionModel, visionCache);
    if (opts.signal?.aborted) {
      return finalize({ reason: "aborted", phase: "vision", message: "Aborted during vision pass." });
    }
    return finalize({
      reason: "vision-failed",
      phase: "vision",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  writeVisionCache(opts.workDir, adapters.vision.visionModel, visionCache);

  // ---------- phase: weave ----------
  const woven = await timePhase("weave", async () => weave(opts.transcript, candidates));

  // Persist the augmented transcript + metrics into the per-videoId workDir so
  // future runs (ask, another generate, another transcript --with-frames on
  // the same video) return from the cache short-circuit at the top of this
  // function. Best-effort: a write failure here doesn't fail the run — the
  // caller still gets the freshly-built result.
  try {
    const finalMetrics: FramesMetrics = { ...metrics, wallClockMs: Date.now() - startedAt };
    writeFileSync(resolve(opts.workDir, AUGMENTED_CACHE_FILE), woven);
    writeFileSync(resolve(opts.workDir, METRICS_CACHE_FILE), JSON.stringify(finalMetrics, null, 2));
  } catch {
    // Swallow — caching is a perf optimization, not a correctness requirement.
  }

  return finalize(null, woven);
}

/**
 * Bounded-concurrency map. Workers pull from a shared cursor; once items are
 * exhausted each worker exits. Throws propagate to the caller — used by the
 * orchestrator to turn the first failed LLM call into an `attempted-failed`.
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let nextIdx = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIdx++;
      if (idx >= items.length) return;
      await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

function readScenesCache(workDir: string): number[] | null {
  const path = resolve(workDir, SCENES_CACHE_FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as ScenesCache;
    if (!Array.isArray(parsed.scenes)) return null;
    if (!parsed.scenes.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return parsed.scenes;
  } catch {
    return null;
  }
}

function writeScenesCache(workDir: string, scenes: number[]): void {
  try {
    writeFileSync(resolve(workDir, SCENES_CACHE_FILE), JSON.stringify({ scenes } satisfies ScenesCache));
  } catch {
    // Best-effort; cache writes never fail the run.
  }
}

/**
 * Reads the classifier cache scoped to `model`. Returns an empty object when
 * the cache file is absent, malformed, or was produced by a different model.
 * Returning a mutable record (not null) lets the classify phase write new
 * entries into it and flush atomically at the end.
 */
function readClassificationsCache(workDir: string, model: string): Record<string, ClassifyResult> {
  const path = resolve(workDir, CLASSIFICATIONS_CACHE_FILE);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as ClassificationsCache;
    if (parsed.classifierModel !== model) return {};
    return isPlainRecord(parsed.entries) ? (parsed.entries as Record<string, ClassifyResult>) : {};
  } catch {
    return {};
  }
}

function writeClassificationsCache(
  workDir: string,
  model: string,
  entries: Record<string, ClassifyResult>,
): void {
  try {
    const payload: ClassificationsCache = { classifierModel: model, entries };
    writeFileSync(resolve(workDir, CLASSIFICATIONS_CACHE_FILE), JSON.stringify(payload));
  } catch {
    // Best-effort.
  }
}

function readVisionCache(workDir: string, model: string): Record<string, VisionCacheEntry> {
  const path = resolve(workDir, VISION_CACHE_FILE);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as VisionCache;
    if (parsed.visionModel !== model) return {};
    return isPlainRecord(parsed.entries) ? (parsed.entries as Record<string, VisionCacheEntry>) : {};
  } catch {
    return {};
  }
}

/**
 * True for shapes that can be safely treated as a string-keyed mutable map.
 * Used to gate phase-cache reads so a malformed sidecar (array, null, primitive)
 * never reaches a downstream `cache[key] = value` write and crashes the run.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeVisionCache(
  workDir: string,
  model: string,
  entries: Record<string, VisionCacheEntry>,
): void {
  try {
    const payload: VisionCache = { visionModel: model, entries };
    writeFileSync(resolve(workDir, VISION_CACHE_FILE), JSON.stringify(payload));
  } catch {
    // Best-effort.
  }
}

// Re-export Candidate for adapter authors who want to inspect the orchestrator
// inputs in tests; consumers of the public surface stay on `FramesResult`.
export type { Candidate };
