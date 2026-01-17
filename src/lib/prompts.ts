import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * System prompt loaded from markdown file
 */
export const systemPrompt = readFileSync(
  join(__dirname, "prompts/system.md"),
  "utf-8"
);

/**
 * User prompt template loaded from markdown file
 */
const userPromptTemplate = readFileSync(
  join(__dirname, "prompts/user-template.md"),
  "utf-8"
);

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
