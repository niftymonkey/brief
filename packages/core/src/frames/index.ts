import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, type LanguageModel } from "ai";
import { CLASSIFY_MODEL, VISION_MODEL } from "../models";
import type { TranscriptEntry } from "../types";
import { selectCandidates, type Candidate, type Chapter } from "./selection";
import { weave } from "./weave";

export type { Chapter } from "./selection";

/**
 * Public surface for the video-frames pipeline. Single function entry point.
 *
 * Phase 1 lift from spikes/video-frames-pipeline/pipeline.mjs. Same 8-phase
 * orchestration (download → scene-detect → select → extract → classify →
 * vision → weave). Failures downgrade to `attempted-failed` so the caller
 * can ship transcript-only briefs instead of crashing.
 */
export interface FramesOptions {
  videoId: string;
  transcript: TranscriptEntry[];
  chapters?: Chapter[] | null;
  openRouterApiKey: string;
  workDir: string;
  maxCandidates?: number;
  signal?: AbortSignal;
}

export type FramesResult =
  | { kind: "included"; transcript: string; metrics: FramesMetrics }
  | {
      kind: "attempted-failed";
      reason: FramesFailReason;
      phase: FramesPhase;
      message: string;
      metrics: FramesMetrics;
    };

export type FramesFailReason =
  | "missing-system-dep"
  | "download-blocked-bot-detection"
  | "video-not-public"
  | "download-failed"
  | "ffmpeg-failed"
  | "vision-failed"
  | "budget-exceeded"
  | "aborted"
  | "unknown";

export type FramesPhase =
  | "preflight"
  | "download"
  | "scene-detection"
  | "selection"
  | "extraction"
  | "classify"
  | "vision"
  | "weave";

export interface FramesMetrics {
  videoDurationSec: number;
  candidatesGenerated: number;
  candidatesAfterDedup: number;
  classifierYes: number;
  classifierNo: number;
  visionCalls: number;
  inputTokens: number;
  outputTokens: number;
  classifierModel: string;
  visionModel: string;
  wallClockMs: number;
  costSource: "cli-reported";
}

const DEFAULT_MAX_CANDIDATES = 100;
const SCENE_THRESHOLD = 0.2;
const CLASSIFIER_CONCURRENCY = 5;
const VISION_CONCURRENCY = 4;

export async function extractFrames(opts: FramesOptions): Promise<FramesResult> {
  const startedAt = Date.now();
  const maxCandidates = opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

  const metrics: FramesMetrics = {
    videoDurationSec: 0,
    candidatesGenerated: 0,
    candidatesAfterDedup: 0,
    classifierYes: 0,
    classifierNo: 0,
    visionCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    classifierModel: CLASSIFY_MODEL,
    visionModel: VISION_MODEL,
    wallClockMs: 0,
    costSource: "cli-reported",
  };

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

  const missing = checkSystemDeps();
  if (missing) {
    return finalize({
      reason: "missing-system-dep",
      phase: "preflight",
      message: `Required CLI tool '${missing}' not found on PATH. Install yt-dlp (https://github.com/yt-dlp/yt-dlp) and ffmpeg (https://ffmpeg.org/) and try again.`,
    });
  }

  mkdirSync(opts.workDir, { recursive: true });
  const framesDir = resolve(opts.workDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  const videoPath = resolve(opts.workDir, `${opts.videoId}.mp4`);
  const infoPath = resolve(opts.workDir, `${opts.videoId}.info.json`);

  // Lifecycle: caller owns workDir. The pipeline reuses any cached video/info/frame
  // bytes already present (yt-dlp and ffmpeg both short-circuit on existing files),
  // and never deletes anything. Callers that want transient bytes pass a fresh
  // mkdtempSync path and rmSync after; callers that want cache reuse pass a stable
  // per-videoId path and skip the cleanup.
  {
    // ---------- phase: download ----------
    try {
      if (!existsSync(videoPath) || !existsSync(infoPath)) {
        execSync(
          `yt-dlp -f 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]' --merge-output-format mp4 --write-info-json -o '${opts.videoId}.%(ext)s' '${opts.videoId}'`,
          { cwd: opts.workDir, stdio: "pipe" },
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const reason: FramesFailReason = /sign in to confirm you'?re not a bot/i.test(message)
        ? "download-blocked-bot-detection"
        : /private|members-only|sign in|age-restricted|login required/i.test(message)
          ? "video-not-public"
          : "download-failed";
      return finalize({ reason, phase: "download", message });
    }

    if (opts.signal?.aborted) {
      return finalize({ reason: "aborted", phase: "download", message: "Aborted after download." });
    }

    // ---------- phase: scene-detection ----------
    let scenes: number[];
    let durationSec = 0;
    try {
      scenes = detectScenes(videoPath);
      const info = JSON.parse(readFileSync(infoPath, "utf8")) as { duration?: number };
      durationSec = info.duration ?? 0;
      metrics.videoDurationSec = durationSec;
    } catch (err) {
      return finalize({
        reason: "ffmpeg-failed",
        phase: "scene-detection",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // ---------- phase: selection ----------
    const { candidates, candidatesGenerated } = selectCandidates({
      scenes,
      chapters: opts.chapters ?? [],
      transcript: opts.transcript,
      durationSec,
    });
    metrics.candidatesGenerated = candidatesGenerated;
    metrics.candidatesAfterDedup = candidates.length;

    if (candidates.length > maxCandidates) {
      return finalize({
        reason: "budget-exceeded",
        phase: "selection",
        message: `Candidate count ${candidates.length} exceeds cap ${maxCandidates}.`,
      });
    }

    if (opts.signal?.aborted) {
      return finalize({ reason: "aborted", phase: "selection", message: "Aborted before extraction." });
    }

    // ---------- phase: extraction ----------
    try {
      extractFramesToDisk(candidates, videoPath, framesDir);
    } catch (err) {
      return finalize({
        reason: "ffmpeg-failed",
        phase: "extraction",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // ---------- phase: classify + vision ----------
    const openrouter = createOpenRouter({ apiKey: opts.openRouterApiKey });
    const classifyModel = openrouter(CLASSIFY_MODEL);
    const visionModel = openrouter(VISION_MODEL);

    try {
      await classifyCandidates(candidates, framesDir, classifyModel, metrics, opts.signal);
    } catch (err) {
      return finalize({
        reason: "vision-failed",
        phase: "classify",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    if (opts.signal?.aborted) {
      return finalize({ reason: "aborted", phase: "classify", message: "Aborted before vision pass." });
    }

    try {
      await describeFrames(candidates, framesDir, visionModel, metrics, opts.signal);
    } catch (err) {
      return finalize({
        reason: "vision-failed",
        phase: "vision",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // ---------- phase: weave ----------
    const woven = weave(opts.transcript, candidates);
    return finalize(null, woven);
  }
}

function checkSystemDeps(): "yt-dlp" | "ffmpeg" | null {
  for (const bin of ["yt-dlp", "ffmpeg"] as const) {
    const result = spawnSync("which", [bin], { encoding: "utf8" });
    if (result.status !== 0) return bin;
  }
  return null;
}

function detectScenes(videoPath: string): number[] {
  const result = spawnSync(
    "ffmpeg",
    [
      "-i", videoPath,
      "-vf", `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
      "-an", "-f", "null", "-",
    ],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
  );

  const times: number[] = [];
  const re = /\[Parsed_showinfo[^\]]*\][^\n]*pts_time:([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(result.stderr))) times.push(parseFloat(m[1]));
  return times;
}

function extractFramesToDisk(candidates: Candidate[], videoPath: string, framesDir: string): void {
  const existing = new Set(readdirSync(framesDir));
  for (const c of candidates) {
    const filename = `frame_t${c.t.toFixed(2)}s.png`;
    c.frame = filename;
    if (existing.has(filename)) continue;
    const result = spawnSync(
      "ffmpeg",
      [
        "-ss", c.t.toString(),
        "-i", videoPath,
        "-frames:v", "1",
        "-q:v", "1",
        "-y",
        "-loglevel", "error",
        resolve(framesDir, filename),
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(`ffmpeg frame extraction failed at t=${c.t}: ${result.stderr}`);
    }
  }
}

type AiModel = LanguageModel;

const CLASSIFIER_PROMPT = `Look at this frame from a YouTube video. Decide whether it carries visual information beyond what spoken narration would convey:

- Reply "yes" if the frame contains: text, code, slides, diagrams, charts, app/web UI, terminal output, dashboards, screenshots, file trees, IDE windows, screenshots of social posts, or any other on-screen content where the visible elements convey information that spoken words alone would miss.
- Reply "no" if the frame is just the speaker on camera, generic B-roll (outdoor, hands typing without visible screen content, etc.), title cards with just a name, or stock footage. Only what the speaker is saying matters in these.

When uncertain, lean "yes". Reply with exactly one word: yes or no.`;

const VISION_PROMPT = `You're extracting on-screen content from a YouTube video frame for a reader who is consuming the video as a transcript+visuals document. They will not see the image itself.

Identify the PRIMARY on-screen content (the thing the speaker is showing, not background chrome). Then choose ONE of two modes:

**VERBATIM mode** — use when the primary content is something a viewer would plausibly want to copy out of the video and paste somewhere: code blocks, configuration files, system prompts, LLM instructions, terminal commands, URLs, regex patterns, JSON/YAML, structured templates, file content, schemas, anything intended for direct reuse.

In verbatim mode: reproduce the visible text WORD-FOR-WORD as it appears on screen. Preserve original formatting (line breaks, indentation, headers, bullet markers). Do not paraphrase. Do not add a summary. Lead with a one-line label like "[Obsidian note titled X]" then the verbatim content as a code block. Mark unreadable spans "[illegible]" rather than guessing. Use as many tokens as needed up to your output limit.

**SUMMARY mode** — use when the primary content is descriptive: a slide explaining a concept, a diagram, a dashboard, a busy screen recording, a multi-pane composite, the speaker on camera, a browser tab with mixed content.

In summary mode: write a single concise paragraph under 200 words. Quote specific labels, headings, names, prices, URLs, and short identifiers. Briefly state the scene type (slide / dashboard / IDE / diagram / etc.).

If both apply (e.g., a slide that contains a code block as its central content), prefer VERBATIM for the central content and add one short sentence of context.

Don't pad with "this frame shows" or "the screen displays" filler. Lead with the content.`;

async function classifyCandidates(
  candidates: Candidate[],
  framesDir: string,
  model: AiModel,
  metrics: FramesMetrics,
  signal: AbortSignal | undefined,
): Promise<void> {
  await pmap(candidates, CLASSIFIER_CONCURRENCY, async (c) => {
    if (signal?.aborted) return;
    if (!c.frame) return;
    const data = readFileSync(resolve(framesDir, c.frame), { encoding: "base64" });
    try {
      const result = await generateText({
        model,
        // 16 is the floor enforced by some OpenRouter-routed providers (e.g. Azure-hosted GPT-5 nano).
        // Anthropic-direct accepts 5; routing through OpenRouter forces us to the higher minimum.
        maxOutputTokens: 16,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", image: data, mediaType: "image/png" },
              { type: "text", text: CLASSIFIER_PROMPT },
            ],
          },
        ],
        ...(signal ? { abortSignal: signal } : {}),
      });
      const text = result.text.trim().toLowerCase();
      const verdict: "yes" | "no" = text.startsWith("yes") ? "yes" : "no";
      c.classification = { verdict };
      if (verdict === "yes") metrics.classifierYes++;
      else metrics.classifierNo++;
      metrics.inputTokens += result.usage.inputTokens ?? 0;
      metrics.outputTokens += result.usage.outputTokens ?? 0;
    } catch (err) {
      if (signal?.aborted) return;
      c.classification = { verdict: "error" };
      throw err;
    }
  });
}

async function describeFrames(
  candidates: Candidate[],
  framesDir: string,
  model: AiModel,
  metrics: FramesMetrics,
  signal: AbortSignal | undefined,
): Promise<void> {
  const yesFrames = candidates.filter((c) => c.classification?.verdict === "yes");
  await pmap(yesFrames, VISION_CONCURRENCY, async (c) => {
    if (signal?.aborted) return;
    if (!c.frame) return;
    const data = readFileSync(resolve(framesDir, c.frame), { encoding: "base64" });
    const result = await generateText({
      model,
      maxOutputTokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", image: data, mediaType: "image/png" },
            { type: "text", text: VISION_PROMPT },
          ],
        },
      ],
      ...(signal ? { abortSignal: signal } : {}),
    });
    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    c.vision = {
      description: result.text.trim(),
      inputTokens,
      outputTokens,
    };
    metrics.visionCalls++;
    metrics.inputTokens += inputTokens;
    metrics.outputTokens += outputTokens;
  });
}

async function pmap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIdx = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIdx++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}


