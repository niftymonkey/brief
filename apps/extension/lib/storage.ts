export interface RecentBrief {
  jobId: string;
  videoUrl: string;
  videoTitle: string;
  status: "processing" | "completed" | "failed";
  briefId?: string;
  error?: string;
  createdAt: number;
  /** Whether the user has seen this completed brief (opened popup after completion). */
  seen?: boolean;
}

const STORAGE_KEY = "recentBriefs";
const MAX_RECENT = 5;

export async function getRecentBriefs(): Promise<RecentBrief[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] ?? [];
}

export async function addRecentBrief(
  brief: Omit<RecentBrief, "status">
): Promise<void> {
  const briefs = await getRecentBriefs();
  briefs.unshift({ ...brief, status: "processing" });
  if (briefs.length > MAX_RECENT) briefs.length = MAX_RECENT;
  await chrome.storage.local.set({ [STORAGE_KEY]: briefs });
}

export async function updateBriefStatus(
  jobId: string,
  status: "completed" | "failed",
  briefId?: string,
  error?: string
): Promise<void> {
  const briefs = await getRecentBriefs();
  const brief = briefs.find((b) => b.jobId === jobId);
  if (brief) {
    brief.status = status;
    if (briefId) brief.briefId = briefId;
    if (error) brief.error = error;
    await chrome.storage.local.set({ [STORAGE_KEY]: briefs });
  }
}

/** Replace a failed entry in-place with a new processing job (same list slot). */
export async function retryBrief(
  oldJobId: string,
  newJobId: string
): Promise<void> {
  const briefs = await getRecentBriefs();
  const brief = briefs.find((b) => b.jobId === oldJobId);
  if (brief) {
    brief.jobId = newJobId;
    brief.status = "processing";
    brief.error = undefined;
    brief.briefId = undefined;
    brief.createdAt = Date.now();
    await chrome.storage.local.set({ [STORAGE_KEY]: briefs });
  }
}

/** Add a brief that was already completed (cached result). */
export async function addCompletedBrief(
  jobId: string,
  videoUrl: string,
  videoTitle: string,
  briefId: string
): Promise<void> {
  const briefs = await getRecentBriefs();
  briefs.unshift({
    jobId,
    videoUrl,
    videoTitle,
    status: "completed",
    briefId,
    createdAt: Date.now(),
  });
  if (briefs.length > MAX_RECENT) briefs.length = MAX_RECENT;
  await chrome.storage.local.set({ [STORAGE_KEY]: briefs });
}

export async function removeRecentBrief(jobId: string): Promise<void> {
  const briefs = await getRecentBriefs();
  await chrome.storage.local.set({
    [STORAGE_KEY]: briefs.filter((b) => b.jobId !== jobId),
  });
}

export function getProcessingBriefs(briefs: RecentBrief[]): RecentBrief[] {
  return briefs.filter((b) => b.status === "processing");
}

export function getUnseenCount(briefs: RecentBrief[]): number {
  return briefs.filter((b) => b.status === "completed" && !b.seen).length;
}

export async function markAllSeen(): Promise<void> {
  const briefs = await getRecentBriefs();
  let changed = false;
  for (const b of briefs) {
    if (b.status === "completed" && !b.seen) {
      b.seen = true;
      changed = true;
    }
  }
  if (changed) {
    await chrome.storage.local.set({ [STORAGE_KEY]: briefs });
  }
}
