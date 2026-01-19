import { readFileSync } from "fs";
import { join } from "path";

const promptsDir = join(process.cwd(), "src/lib/prompts");

/**
 * System prompt for the AI summarizer
 */
export const systemPrompt = readFileSync(join(promptsDir, "system.md"), "utf-8");

/**
 * User prompt template
 */
const userPromptTemplate = readFileSync(join(promptsDir, "user-template.md"), "utf-8");

/**
 * Builds the user prompt by replacing placeholders in the template
 */
export function buildUserPrompt(
  title: string,
  channelTitle: string,
  formattedTranscript: string,
  urls: string[]
): string {
  const urlsSection = urls.length > 0
    ? `URLs found in description/comments:\n${urls.join('\n')}`
    : '';

  return userPromptTemplate
    .replace('{{TITLE}}', title)
    .replace('{{CHANNEL}}', channelTitle)
    .replace('{{TRANSCRIPT}}', formattedTranscript)
    .replace('{{URLS}}', urlsSection);
}
