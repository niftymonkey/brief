import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, type LanguageModel } from "ai";
import { DIGEST_MODEL } from "./models";

/**
 * Single LLM call that answers a question about a video, given an already-built
 * transcript (speech-only or augmented with `[VISUAL]` markers). No DB writes,
 * no server round-trip — `askVideo` is a pure CLI-side wrapper around an
 * OpenRouter `generateText` call. The transcript is the entire video context;
 * the function does not fetch, build, or cache it.
 *
 * Callers compose: `extractFrames(...) → augmented transcript → askVideo(...)`.
 * Or feed an arbitrary transcript string (e.g. piped via stdin).
 */
export interface AskVideoOptions {
  /** The transcript text to ground the answer in. Pre-built by the caller. */
  transcript: string;
  /** The user's question. */
  question: string;
  /** OpenRouter API key. Ignored if `_model` is supplied (test path). */
  openRouterApiKey: string;
  /** Optional OpenRouter model id override; defaults to `DIGEST_MODEL`. */
  model?: string;
  signal?: AbortSignal;
  /**
   * Test seam: pre-resolved `LanguageModel`. When supplied, `openRouterApiKey`
   * is unused and no OpenRouter client is constructed. Underscored to signal
   * non-public intent.
   */
  _model?: LanguageModel;
}

export interface AskVideoMetrics {
  inputTokens: number;
  outputTokens: number;
  model: string;
  latencyMs: number;
}

export type AskVideoFailReason = "auth" | "rate-limited" | "transient";

export type AskVideoResult =
  | { kind: "ok"; answer: string; metrics: AskVideoMetrics }
  | { kind: "failed"; reason: AskVideoFailReason; message: string };

export const ASK_SYSTEM_PROMPT = `You are answering a user's question about the contents of a video. The user will provide a transcript followed by a question.

The transcript is timestamped in [MM:SS] or [MM:SS-MM:SS] format. Some lines have the form \`[MM:SS] [VISUAL] ...\` — those are descriptions of on-screen content (slides, code, dashboards, terminal output, configuration files, etc.) captured from the video at that moment, which the speaker may not have read aloud. Treat [VISUAL] lines as first-class video content; their information is as real as the spoken words.

When you cite a specific moment, include the [MM:SS] timestamp. When a [VISUAL] line contains verbatim content (code blocks, prompt templates, configuration files), surface it verbatim rather than paraphrasing it away. If the question genuinely can't be answered from the transcript, say so plainly — do not guess.`;

export async function askVideo(opts: AskVideoOptions): Promise<AskVideoResult> {
  const modelId = opts.model ?? DIGEST_MODEL;
  const model: LanguageModel =
    opts._model ?? createOpenRouter({ apiKey: opts.openRouterApiKey })(modelId);

  const userPrompt = `Transcript:\n\n${opts.transcript}\n\nQuestion: ${opts.question}`;

  const startedAt = Date.now();
  try {
    const result = await generateText({
      model,
      system: ASK_SYSTEM_PROMPT,
      prompt: userPrompt,
      ...(opts.signal ? { abortSignal: opts.signal } : {}),
    });
    return {
      kind: "ok",
      answer: result.text.trim(),
      metrics: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        model: modelId,
        latencyMs: Date.now() - startedAt,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reason: AskVideoFailReason = /401|authentication|invalid.+api.+key/i.test(message)
      ? "auth"
      : /rate.?limit|429/i.test(message)
        ? "rate-limited"
        : "transient";
    return { kind: "failed", reason, message };
  }
}
