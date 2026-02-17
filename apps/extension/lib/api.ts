import type {
  CreateBriefResponse,
  BriefStatusResponse,
} from "@brief/shared";
import { APP_URL } from "./config";
import { getSessionCookie } from "./auth";

class AuthError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "AuthError";
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const cookie = await getSessionCookie();
  if (!cookie) throw new AuthError();

  const url = `${APP_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      ...init?.headers,
      "Content-Type": "application/json",
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new AuthError();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }

  return res.json();
}

export async function createBrief(
  youtubeUrl: string
): Promise<CreateBriefResponse> {
  return apiFetch<CreateBriefResponse>("/api/briefs", {
    method: "POST",
    body: JSON.stringify({ url: youtubeUrl }),
  });
}

export async function checkBriefStatus(
  jobId: string
): Promise<BriefStatusResponse> {
  return apiFetch<BriefStatusResponse>(`/api/briefs/${jobId}/status`);
}

export { AuthError };
