/**
 * Email-based access control for brief generation.
 * Temporary solution until BYOK is implemented.
 */

const ALLOWED_EMAILS_ENV = process.env.ALLOWED_EMAILS ?? "";

/**
 * Parse the comma-delimited ALLOWED_EMAILS env var into a Set for O(1) lookups.
 * Emails are normalized to lowercase and trimmed.
 */
function getAllowedEmails(): Set<string> {
  if (!ALLOWED_EMAILS_ENV) {
    return new Set();
  }

  return new Set(
    ALLOWED_EMAILS_ENV.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0)
  );
}

const allowedEmails = getAllowedEmails();

/**
 * Check if an email is allowed to generate briefs.
 * Returns true only if the email is explicitly in the allow list.
 * If ALLOWED_EMAILS is not set or empty, no one can generate briefs.
 */
export function isEmailAllowed(email: string | undefined | null): boolean {
  if (!email) {
    return false;
  }

  // If no allow list is configured, no one is allowed
  if (allowedEmails.size === 0) {
    return false;
  }

  return allowedEmails.has(email.toLowerCase());
}
