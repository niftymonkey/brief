import { readFileSync } from "node:fs";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, type LanguageModel } from "ai";
import { CLASSIFY_MODEL, VISION_MODEL } from "../models";

export type ClassifyVerdict = "yes" | "no";

export interface ClassifyResult {
  verdict: ClassifyVerdict;
  inputTokens: number;
  outputTokens: number;
}

export type VisionMode = "verbatim" | "summary";

export interface VisionDescribeResult {
  description: string;
  /**
   * Which mode the model chose for this frame. Parsed from a leading
   * `<mode>verbatim</mode>` / `<mode>summary</mode>` marker that the prompt
   * instructs the model to emit. Falls back to "summary" if the marker is
   * missing or malformed — keeps the pipeline robust to occasional drift.
   */
  mode: VisionMode;
  inputTokens: number;
  outputTokens: number;
}

/**
 * The single external seam — Phase 4 swaps the real OpenRouter-backed adapter
 * for an in-memory stub. Production adapter holds two prompts (classifier
 * cheap-yes/no, vision verbatim-or-summary) and converts image content to the
 * AI SDK's image-content-block shape.
 */
export interface VisionClient {
  classify(framePath: string, signal?: AbortSignal): Promise<ClassifyResult>;
  describe(framePath: string, signal?: AbortSignal): Promise<VisionDescribeResult>;
  /** Surfaced so metrics can record which models actually ran without re-importing constants. */
  readonly classifierModel: string;
  readonly visionModel: string;
}

export const CLASSIFIER_PROMPT = `Look at this frame from a YouTube video. Decide whether it carries visual information beyond what spoken narration would convey:

- Reply "yes" if the frame contains: text, code, slides, diagrams, charts, app/web UI, terminal output, dashboards, screenshots, file trees, IDE windows, screenshots of social posts, or any other on-screen content where the visible elements convey information that spoken words alone would miss.
- Reply "no" if the frame is just the speaker on camera, generic B-roll (outdoor, hands typing without visible screen content, etc.), title cards with just a name, or stock footage. Only what the speaker is saying matters in these.

When uncertain, lean "yes". Reply with exactly one word: yes or no.`;

export const VISION_PROMPT = `You're extracting on-screen content from a YouTube video frame for a reader who is consuming the video as a transcript+visuals document. They will not see the image itself.

Identify the PRIMARY on-screen content (the thing the speaker is showing, not background chrome). Then choose ONE of two modes:

**VERBATIM mode** — use when the primary content is something a viewer would plausibly want to copy out of the video and paste somewhere: code blocks, configuration files, system prompts, LLM instructions, terminal commands, URLs, regex patterns, JSON/YAML, structured templates, file content, schemas, anything intended for direct reuse.

In verbatim mode: reproduce the visible text WORD-FOR-WORD as it appears on screen. Preserve original formatting (line breaks, indentation, headers, bullet markers). Do not paraphrase. Do not add a summary. Lead with a one-line label like "[Obsidian note titled X]" then the verbatim content as a code block. Mark unreadable spans "[illegible]" rather than guessing. Use as many tokens as needed up to your output limit.

**SUMMARY mode** — use when the primary content is descriptive: a slide explaining a concept, a diagram, a dashboard, a busy screen recording, a multi-pane composite, the speaker on camera, a browser tab with mixed content.

In summary mode: write a single concise paragraph under 200 words. Quote specific labels, headings, names, prices, URLs, and short identifiers. Briefly state the scene type (slide / dashboard / IDE / diagram / etc.).

If both apply (e.g., a slide that contains a code block as its central content), prefer VERBATIM for the central content and add one short sentence of context.

Don't pad with "this frame shows" or "the screen displays" filler. Lead with the content.

Begin your response with exactly one of these mode markers on the first line:
\`<mode>verbatim</mode>\`
\`<mode>summary</mode>\`
Then continue with the content as described above. The marker is for downstream processing; do not reference it in your prose.`;

// 16 is the floor enforced by some OpenRouter-routed providers (e.g. Azure-hosted GPT-5 nano).
// Anthropic-direct accepts 5; routing through OpenRouter forces us to the higher minimum.
const CLASSIFIER_MAX_OUTPUT_TOKENS = 16;
const VISION_MAX_OUTPUT_TOKENS = 2000;

const MODE_MARKER_RE = /^\s*<mode>(verbatim|summary)<\/mode>\s*/i;

/**
 * Extracts the mode marker the vision prompt instructs the model to emit on
 * the first line. Returns the parsed mode and the description with the marker
 * stripped. If the marker is missing/malformed (model drift), defaults to
 * "summary" and leaves the description text alone — verbatim content is
 * easier to detect by structure later if we ever need to backfill.
 */
export function parseModeMarker(rawText: string): { mode: VisionMode; description: string } {
  const m = rawText.match(MODE_MARKER_RE);
  if (!m) return { mode: "summary", description: rawText.trim() };
  const mode = m[1].toLowerCase() as VisionMode;
  const description = rawText.slice(m[0].length).trim();
  return { mode, description };
}

export interface OpenRouterVisionClientOptions {
  apiKey: string;
  classifyModelId?: string;
  visionModelId?: string;
}

export function createOpenRouterVisionClient(opts: OpenRouterVisionClientOptions): VisionClient {
  const openrouter = createOpenRouter({ apiKey: opts.apiKey });
  const classifyModelId = opts.classifyModelId ?? CLASSIFY_MODEL;
  const visionModelId = opts.visionModelId ?? VISION_MODEL;
  const classifyModel: LanguageModel = openrouter(classifyModelId);
  const visionModel: LanguageModel = openrouter(visionModelId);

  return {
    classifierModel: classifyModelId,
    visionModel: visionModelId,

    async classify(framePath, signal) {
      const data = readFileSync(framePath, { encoding: "base64" });
      const result = await generateText({
        model: classifyModel,
        maxOutputTokens: CLASSIFIER_MAX_OUTPUT_TOKENS,
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
      const verdict: ClassifyVerdict = text.startsWith("yes") ? "yes" : "no";
      return {
        verdict,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      };
    },

    async describe(framePath, signal) {
      const data = readFileSync(framePath, { encoding: "base64" });
      const result = await generateText({
        model: visionModel,
        maxOutputTokens: VISION_MAX_OUTPUT_TOKENS,
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
      const parsed = parseModeMarker(result.text);
      return {
        description: parsed.description,
        mode: parsed.mode,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      };
    },
  };
}
