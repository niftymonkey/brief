/**
 * Builds the per-clip summarization prompt for a collection item. The prompt
 * scales to the length of the referenced range: a 30-second clip is asked for a
 * sentence or two; a long excerpt gets a short paragraph or two. There are no
 * chapter floors and no bullet quotas, so a tiny clip never gets padded into a
 * structure it does not deserve (the proportionality requirement from #115).
 *
 * The prompt lives server-side alongside the other gateway prompts so iterating
 * on summary quality never requires a client release.
 */

export type SummaryTierId =
  | "whole-short"
  | "micro"
  | "brief"
  | "standard"
  | "extended";

export interface SummaryTier {
  id: SummaryTierId;
  /** Length instruction embedded verbatim in the prompt. */
  guidance: string;
  /** Output-token ceiling for this tier, scaled to the guidance length. */
  maxOutputTokens: number;
}

const WHOLE_SHORT: SummaryTier = {
  id: "whole-short",
  guidance: "Write one or two sentences capturing what this short video is about.",
  maxOutputTokens: 160,
};

const MICRO: SummaryTier = {
  id: "micro",
  guidance: "Write a single sentence (two at most) capturing what this part covers.",
  maxOutputTokens: 120,
};

const BRIEF: SummaryTier = {
  id: "brief",
  guidance: "Write one to two sentences capturing what this part covers.",
  maxOutputTokens: 200,
};

const STANDARD: SummaryTier = {
  id: "standard",
  guidance: "Write a short paragraph (a few sentences) capturing what this part covers.",
  maxOutputTokens: 400,
};

const EXTENDED: SummaryTier = {
  id: "extended",
  guidance:
    "Write up to two short paragraphs capturing what this part covers. Use the second only if the material genuinely needs it.",
  maxOutputTokens: 600,
};

/**
 * Chooses a length tier from the clip's range length in seconds. `null` (a
 * whole-Short item with no range) maps to the whole-short tier.
 */
export function summaryTier(rangeSeconds: number | null): SummaryTier {
  if (rangeSeconds === null) return WHOLE_SHORT;
  if (rangeSeconds <= 30) return MICRO;
  if (rangeSeconds <= 120) return BRIEF;
  if (rangeSeconds <= 420) return STANDARD;
  return EXTENDED;
}

export interface BuildSummaryPromptInput {
  rangeSeconds: number | null;
  transcriptText: string;
  videoTitle?: string;
}

export interface SummaryPrompt {
  system: string;
  user: string;
  tier: SummaryTier;
}

const SYSTEM_PROMPT = `You summarize a specific excerpt of a YouTube video for someone browsing a curated collection of clips. Each summary tells the reader what this particular part is about so they can decide whether to watch it.

Describe only the referenced excerpt, not the rest of the video. Lead with the substance. Do not open with filler like "In this clip" or "This segment". Match the requested length exactly: short material gets a short summary, and you never pad a brief clip into a longer structure. Return prose only, with no headings, labels, or lists.`;

/**
 * Builds the system + user prompt pair for one clip. `tier` is returned so the
 * caller can size the LLM's output-token budget to the same tier the prompt
 * asks for.
 */
export function buildSummaryPrompt(input: BuildSummaryPromptInput): SummaryPrompt {
  const tier = summaryTier(input.rangeSeconds);
  const scope =
    input.rangeSeconds === null
      ? "The item is a whole short video."
      : "The item references a specific part of a longer video. Summarize only that part.";

  const titleLine = input.videoTitle ? `Video title: ${input.videoTitle}\n\n` : "";

  const user = `${titleLine}${scope}

${tier.guidance}

Transcript of the excerpt:
"""
${input.transcriptText}
"""`;

  return { system: SYSTEM_PROMPT, user, tier };
}
