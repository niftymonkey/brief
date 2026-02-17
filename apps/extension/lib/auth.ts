import { APP_URL, COOKIE_NAME } from "./config";

/** Read the WorkOS session cookie from the Brief app domain. */
export async function getSessionCookie(): Promise<string | null> {
  const cookie = await chrome.cookies.get({
    url: APP_URL,
    name: COOKIE_NAME,
  });
  return cookie?.value ?? null;
}
