import { checkBriefStatus, AuthError } from "@/lib/api";
import {
  getRecentBriefs,
  getProcessingBriefs,
  getUnseenCount,
  updateBriefStatus,
  removeRecentBrief,
} from "@/lib/storage";
import { APP_URL } from "@/lib/config";

const POLL_DELAY_MS = 30_000;
const POLL_INTERVAL_MS = 30_000;
const STALE_JOB_MS = 5 * 60_000;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

function notify(id: string, title: string, message: string) {
  chrome.notifications
    .create(id, { type: "basic", iconUrl: "icon-128.png", title, message })
    .catch(() => {});
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "brief-created") {
      startPolling(POLL_DELAY_MS);
      updateBadge();
    }
    if (message.type === "poll-now") {
      Promise.all([pollPendingJobs(), verifyCompletedBriefs()])
        .then(() => sendResponse({ done: true }))
        .catch(() => sendResponse({ done: true }));
      return true;
    }
  });

  chrome.notifications.onClicked.addListener(async (notificationId) => {
    if (notificationId.startsWith("brief-complete-")) {
      const briefId = notificationId.replace("brief-complete-", "");
      chrome.tabs.create({ url: `${APP_URL}/brief/${briefId}` });
    }
    chrome.notifications.clear(notificationId);
  });

  // On startup, check for leftover processing jobs
  updateBadge();
  getRecentBriefs().then((briefs) => {
    if (getProcessingBriefs(briefs).length > 0) startPolling(0);
  });
});

function startPolling(delayMs: number) {
  if (pollTimer) clearTimeout(pollTimer);

  pollTimer = setTimeout(async () => {
    const authOk = await pollPendingJobs();

    if (authOk) {
      const briefs = await getRecentBriefs();
      if (getProcessingBriefs(briefs).length > 0) {
        startPolling(POLL_INTERVAL_MS);
        return;
      }
    }
    pollTimer = null;
  }, delayMs);
}

/** Returns false if auth failed (stops polling). */
async function pollPendingJobs(): Promise<boolean> {
  const briefs = await getRecentBriefs();
  const processing = getProcessingBriefs(briefs);
  if (processing.length === 0) {
    updateBadge();
    return true;
  }

  for (const job of processing) {
    if (Date.now() - job.createdAt > STALE_JOB_MS) {
      await updateBriefStatus(job.jobId, "failed", undefined, "Timed out — please try again.");
      continue;
    }

    try {
      const result = await checkBriefStatus(job.jobId);

      if (result.status === "completed") {
        await updateBriefStatus(job.jobId, "completed", result.briefId);
        notify(
          `brief-complete-${result.briefId}`,
          "Brief Ready",
          job.videoTitle
            ? `Your brief for "${job.videoTitle}" is ready!`
            : "Your brief is ready!"
        );
      } else if (result.status === "failed") {
        await updateBriefStatus(job.jobId, "failed", undefined, result.error);
        notify(
          `brief-failed-${job.jobId}`,
          "Brief Failed",
          result.error || "Something went wrong creating your brief."
        );
      }
    } catch (err) {
      if (err instanceof AuthError) {
        updateBadge();
        return false;
      }
      if (err instanceof Error && err.message === "Brief not found") {
        await removeRecentBrief(job.jobId);
        continue;
      }
    }
  }

  updateBadge();
  return true;
}

/** Re-check completed briefs still exist on the server; remove any that were deleted. */
async function verifyCompletedBriefs() {
  const briefs = await getRecentBriefs();
  const completed = briefs.filter((b) => b.status === "completed");

  for (const brief of completed) {
    try {
      await checkBriefStatus(brief.jobId);
    } catch (err) {
      if (err instanceof AuthError) break;
      if (err instanceof Error && err.message === "Brief not found") {
        await removeRecentBrief(brief.jobId);
      }
    }
  }

  updateBadge();
}

async function updateBadge() {
  const briefs = await getRecentBriefs();
  const count = getUnseenCount(briefs);
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#4aba6a" });
}
