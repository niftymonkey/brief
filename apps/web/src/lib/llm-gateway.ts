/**
 * Server-side LLM gateway. Composes `UsageLedger` and `OpenRouterClient` into
 * a single deep module: every LLM call goes through here, server-attested
 * token counts get written to the ledger inline, and the caller receives a
 * parsed domain result with a `ledgerId` for correlation.
 *
 * Phase 2 ships `classify` only. Phase 3 will add `describe` and `ask`. The
 * CLI consumes this gateway over HTTP via the route handlers under
 * `/api/cli/llm/<op>`; tests compose it in-process with in-memory adapters.
 *
 * Prompts live here, not in the CLI. Iterating on prompt quality no longer
 * requires a CLI release.
 *
 * Architecture: `docs/architecture/llm-gateway.md`. Epic: #94.
 */

import {
  CLASSIFY_MODEL,
  VISION_MODEL,
  type ClassifyResult,
  type ClassifyVerdict,
  type LlmFailReason,
  type VisionDescribeResult,
  type VisionMode,
} from "@brief/core";
import type { OpenRouterClient } from "./openrouter-client";
import type { UsageLedger } from "./usage-ledger";

// Mirrored from `packages/core/src/frames/vision.ts` for Phase 2. The CLI
// keeps its copy until Phase 4 routes the frames pipeline through this
// gateway and deletes the original. Lift the verdict-parsing logic at the
// same time so both edge cases (e.g., quoted "yes", BOM prefix) get a single
// guard rather than two divergent ones.
const CLASSIFIER_PROMPT = `Look at this frame from a YouTube video. Decide whether it carries visual information beyond what spoken narration would convey:

- Reply "yes" if the frame contains: text, code, slides, diagrams, charts, app/web UI, terminal output, dashboards, screenshots, file trees, IDE windows, screenshots of social posts, or any other on-screen content where the visible elements convey information that spoken words alone would miss.
- Reply "no" if the frame is just the speaker on camera, generic B-roll (outdoor, hands typing without visible screen content, etc.), title cards with just a name, or stock footage. Only what the speaker is saying matters in these.

When uncertain, lean "yes". Reply with exactly one word: yes or no.`;

// 16 is the floor enforced by some OpenRouter-routed providers (e.g.
// Azure-hosted GPT-5 nano). Anthropic-direct accepts 5; routing through
// OpenRouter forces the higher minimum.
const CLASSIFIER_MAX_OUTPUT_TOKENS = 16;
const VISION_MAX_OUTPUT_TOKENS = 2000;

const MODE_MARKER_RE = /^\s*<mode>(verbatim|summary)<\/mode>\s*/i;

// Vision prompt lives server-side per the gateway architecture: prompt
// iteration no longer requires a CLI release. Mirrors the spec from the
// pre-migration `packages/core/src/frames/vision.ts`. When that file
// collapses into a thin client adapter, remove its copy.
const VISION_PROMPT = `You're extracting on-screen content from a YouTube video frame for a reader who is consuming the video as a transcript+visuals document. They will not see the image itself.

Identify the PRIMARY on-screen content (the thing the speaker is showing, not background chrome). Then choose ONE of two modes:

**VERBATIM mode** when the primary content is something a viewer would plausibly want to copy out of the video and paste somewhere: code blocks, configuration files, system prompts, LLM instructions, terminal commands, URLs, regex patterns, JSON/YAML, structured templates, file content, schemas, anything intended for direct reuse.

In verbatim mode: reproduce the visible text WORD-FOR-WORD as it appears on screen. Preserve original formatting (line breaks, indentation, headers, bullet markers). Do not paraphrase. Do not add a summary. Lead with a one-line label like "[Obsidian note titled X]" then the verbatim content as a code block. Mark unreadable spans "[illegible]" rather than guessing. Use as many tokens as needed up to your output limit.

**SUMMARY mode** when the primary content is descriptive: a slide explaining a concept, a diagram, a dashboard, a busy screen recording, a multi-pane composite, the speaker on camera, a browser tab with mixed content.

In summary mode: write a single concise paragraph under 200 words. Quote specific labels, headings, names, prices, URLs, and short identifiers. Briefly state the scene type (slide / dashboard / IDE / diagram / etc.).

If both apply (e.g., a slide that contains a code block as its central content), prefer VERBATIM for the central content and add one short sentence of context.

Don't pad with "this frame shows" or "the screen displays" filler. Lead with the content.

Begin your response with exactly one of these mode markers on the first line:
\`<mode>verbatim</mode>\`
\`<mode>summary</mode>\`
Then continue with the content as described above. The marker is for downstream processing; do not reference it in your prose.`;

export interface ClassifyInput {
  userId: string;
  frame: Buffer;
  signal?: AbortSignal;
}

export type DescribeInput = ClassifyInput;

export interface ServerLlmGateway {
  classify(input: ClassifyInput): Promise<ClassifyResult>;
  describe(input: DescribeInput): Promise<VisionDescribeResult>;
}

export interface ServerLlmGatewayOptions {
  ledger: UsageLedger;
  openrouter: OpenRouterClient;
  classifyModel?: string;
  visionModel?: string;
}

export function createServerLlmGateway(
  opts: ServerLlmGatewayOptions,
): ServerLlmGateway {
  const classifyModel = opts.classifyModel ?? CLASSIFY_MODEL;
  const visionModel = opts.visionModel ?? VISION_MODEL;

  return {
    async classify(input) {
      const start = Date.now();
      let result;
      try {
        result = await opts.openrouter.generateText({
          model: classifyModel,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", image: input.frame, mediaType: "image/png" },
                { type: "text", text: CLASSIFIER_PROMPT },
              ],
            },
          ],
          maxOutputTokens: CLASSIFIER_MAX_OUTPUT_TOKENS,
          ...(input.signal ? { signal: input.signal } : {}),
        });
      } catch (err) {
        return {
          kind: "failed",
          reason: mapLlmError(err),
          message: errMessage(err),
        };
      }
      const latencyMs = Date.now() - start;

      // Read usage exactly once so the value written to the ledger and the
      // value returned to the caller are syntactically the same observation,
      // not a coincidence of two reads against the same field.
      const { inputTokens, outputTokens } = result.usage;
      const verdict: ClassifyVerdict = parseVerdict(result.text);

      let ledgerId: string;
      try {
        ledgerId = await opts.ledger.record({
          userId: input.userId,
          op: "classify",
          model: classifyModel,
          inputTokens,
          outputTokens,
          latencyMs,
        });
      } catch (err) {
        // The LLM call already happened (real token spend) but the audit row
        // could not be written. Returning `kind: "ok"` here would hand the
        // caller a verdict it can act on without an attribution row, which
        // breaks the invariant the gateway exists to enforce. Discard the
        // verdict; let the caller retry. The double-spend on retry is the
        // explicit cost of trustworthy attribution.
        return {
          kind: "failed",
          reason: "transient",
          message: `ledger write failed: ${errMessage(err)}`,
        };
      }

      return {
        kind: "ok",
        verdict,
        inputTokens,
        outputTokens,
        ledgerId,
        model: classifyModel,
      };
    },

    async describe(input) {
      const start = Date.now();
      let result;
      try {
        result = await opts.openrouter.generateText({
          model: visionModel,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", image: input.frame, mediaType: "image/png" },
                { type: "text", text: VISION_PROMPT },
              ],
            },
          ],
          maxOutputTokens: VISION_MAX_OUTPUT_TOKENS,
          ...(input.signal ? { signal: input.signal } : {}),
        });
      } catch (err) {
        return {
          kind: "failed",
          reason: mapLlmError(err),
          message: errMessage(err),
        };
      }
      const latencyMs = Date.now() - start;

      const { inputTokens, outputTokens } = result.usage;
      const { mode, description } = parseModeMarker(result.text);

      let ledgerId: string;
      try {
        ledgerId = await opts.ledger.record({
          userId: input.userId,
          op: "describe",
          model: visionModel,
          inputTokens,
          outputTokens,
          latencyMs,
        });
      } catch (err) {
        // Same invariant as classify: drop the result rather than return a
        // verdict with no audit row. Caller retries; the double spend is the
        // explicit cost of trustworthy attribution.
        return {
          kind: "failed",
          reason: "transient",
          message: `ledger write failed: ${errMessage(err)}`,
        };
      }

      return {
        kind: "ok",
        description,
        mode,
        inputTokens,
        outputTokens,
        ledgerId,
        model: visionModel,
      };
    },
  };
}

/**
 * Extracts the `<mode>verbatim</mode>` / `<mode>summary</mode>` marker the
 * prompt instructs the model to emit on the first line. Returns the parsed
 * mode plus the description with the marker stripped. Missing or malformed
 * marker normalizes to summary, the conservative default for prose.
 */
function parseModeMarker(rawText: string): { mode: VisionMode; description: string } {
  const m = rawText.match(MODE_MARKER_RE);
  if (!m) return { mode: "summary", description: rawText.trim() };
  const mode = m[1].toLowerCase() as VisionMode;
  const description = rawText.slice(m[0].length).trim();
  return { mode, description };
}

/**
 * Maps the classifier's text output to a yes/no verdict, defensively.
 *
 * The prompt asks the model to reply with exactly "yes" or "no", but real
 * outputs sometimes carry common LLM formatting artifacts: a leading UTF-8
 * BOM, surrounding quotes (`"yes"`, `'yes'`, `` `yes` ``), or a stray
 * markdown asterisk. Strip those before checking the prefix so a true
 * affirmative isn't silently flipped to "no" (which would skip a vision
 * call the user paid the classifier for).
 *
 * The bias remains conservative: anything that does not normalize to a
 * leading "yes" is "no".
 */
function parseVerdict(text: string): ClassifyVerdict {
  const cleaned = text
    .replace(/^﻿/, "") // strip UTF-8 BOM
    .replace(/^[\s"'`*_]+/, "") // strip leading whitespace and common wrapper punctuation
    .toLowerCase();
  return cleaned.startsWith("yes") ? "yes" : "no";
}

function mapLlmError(err: unknown): LlmFailReason {
  // OpenRouter / AI SDK errors can expose `statusCode` on `APICallError` and
  // similar. Map the known HTTP shapes; otherwise treat as transient. The
  // route handler in the next slice will refine this based on real errors
  // seen in production traffic.
  if (err && typeof err === "object" && "statusCode" in err) {
    const code = (err as { statusCode: unknown }).statusCode;
    if (code === 401) return "auth";
    if (code === 429) return "rate-limited";
    if (code === 400) return "bad-input";
  }
  return "transient";
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
