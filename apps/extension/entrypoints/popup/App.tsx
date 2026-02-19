import { useState, useEffect } from "react";
import { extractVideoId } from "@/lib/youtube";
import { getSessionCookie } from "@/lib/auth";
import { createBrief, AuthError } from "@/lib/api";
import {
  getRecentBriefs,
  addRecentBrief,
  addCompletedBrief,
  retryBrief,
  removeRecentBrief,
  markAllSeen,
  type RecentBrief,
} from "@/lib/storage";
import { APP_URL } from "@/lib/config";

function cleanTitle(raw: string): string {
  return raw.replace(/^\(\d+\)\s*/, "").replace(/\s*-\s*YouTube$/, "");
}

type TabState =
  | { kind: "loading" }
  | { kind: "not-youtube" }
  | { kind: "not-authenticated" }
  | { kind: "youtube"; videoId: string; url: string; title: string };

export default function App() {
  const [tab, setTab] = useState<TabState>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [briefs, setBriefs] = useState<RecentBrief[]>([]);

  useEffect(() => {
    init();

    const listener = (changes: {
      [key: string]: chrome.storage.StorageChange;
    }) => {
      if (changes.recentBriefs) {
        setBriefs(changes.recentBriefs.newValue ?? []);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  async function init() {
    // Show cached data immediately, then verify in background.
    // The storage.onChanged listener handles any updates from polling.
    setBriefs(await getRecentBriefs());
    markAllSeen();
    chrome.runtime.sendMessage({ type: "poll-now" }).catch(() => {});

    const cookie = await getSessionCookie();
    if (!cookie) {
      setTab({ kind: "not-authenticated" });
      return;
    }

    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!activeTab?.url) {
      setTab({ kind: "not-youtube" });
      return;
    }

    const videoId = extractVideoId(activeTab.url);
    if (!videoId) {
      setTab({ kind: "not-youtube" });
      return;
    }

    setTab({
      kind: "youtube",
      videoId,
      url: activeTab.url,
      title: cleanTitle(activeTab.title || "YouTube Video"),
    });
  }

  async function handleCreate() {
    if (tab.kind !== "youtube") return;
    const { url, title } = tab;

    setCreating(true);
    setCreateError(null);
    try {
      const result = await createBrief(url);

      if (result.status === "completed" && result.briefId) {
        await addCompletedBrief(result.jobId, url, title, result.briefId);
      } else {
        await addRecentBrief({
          jobId: result.jobId,
          videoUrl: url,
          videoTitle: title,
          createdAt: Date.now(),
        });
        chrome.runtime.sendMessage({ type: "brief-created" });
      }
    } catch (err) {
      if (err instanceof AuthError) {
        setTab({ kind: "not-authenticated" });
      } else {
        setCreateError("Something went wrong. Please try again.");
      }
    } finally {
      setCreating(false);
    }
  }

  const isAuthenticated = tab.kind !== "not-authenticated" && tab.kind !== "loading";
  const alreadyExists =
    tab.kind === "youtube" &&
    briefs.some(
      (b) =>
        b.status !== "failed" &&
        extractVideoId(b.videoUrl) === tab.videoId
    );

  return (
    <>
      <Header showAppLink={isAuthenticated} />

      {tab.kind === "loading" && null}

      {tab.kind === "youtube" && !alreadyExists && (
        <div className="current-video">
          <div className="current-video-title">{tab.title}</div>
          {createError && <div className="create-error">{createError}</div>}
          <button
            className="create-btn"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? (
              <>
                <div className="creating-spinner" />
                Creating...
              </>
            ) : (
              <>
                <PlusIcon />
                Create Brief
              </>
            )}
          </button>
        </div>
      )}

      {tab.kind === "not-youtube" && (
        <div className="message-state">
          <p>
            Navigate to a YouTube video
            <br />
            to create a brief.
          </p>
        </div>
      )}

      {tab.kind === "not-authenticated" && (
        <div className="message-state">
          <p>
            Sign in to Brief to start creating
            <br />
            AI summaries of YouTube videos.
          </p>
          <a
            href={APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="signin-btn"
          >
            Sign in to Brief
          </a>
        </div>
      )}

      {isAuthenticated && (
        <BriefsList
          briefs={briefs}
          showBorder={tab.kind === "not-youtube"}
          currentVideoId={tab.kind === "youtube" ? tab.videoId : undefined}
        />
      )}
    </>
  );
}

function Header({ showAppLink }: { showAppLink: boolean }) {
  return (
    <div className="header">
      <div className="brand">
        <div className="brand-icon">
          <svg viewBox="0 0 10 10" fill="none">
            <polygon points="3,1.5 3,8.5 8.5,5" fill="white" />
          </svg>
        </div>
        <span className="brand-name">Brief</span>
      </div>
      {showAppLink && (
        <a
          href={APP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="header-link"
        >
          Open app &rarr;
        </a>
      )}
    </div>
  );
}

function BriefsList({
  briefs,
  showBorder,
  currentVideoId,
}: {
  briefs: RecentBrief[];
  showBorder: boolean;
  currentVideoId?: string;
}) {
  if (briefs.length === 0) {
    return (
      <div className={`briefs-section${showBorder ? " with-border" : ""}`}>
        <div className="empty-state">
          <svg
            className="empty-icon"
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="4" y="6" width="24" height="20" rx="3" />
            <line x1="10" y1="13" x2="22" y2="13" />
            <line x1="10" y1="18" x2="18" y2="18" />
          </svg>
          <div className="empty-text">
            Your recent briefs will
            <br />
            appear here
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`briefs-section${showBorder ? " with-border" : ""}`}>
      <div className="section-label">Recent</div>
      {briefs.map((brief) => (
        <BriefRow
          key={brief.jobId}
          brief={brief}
          active={currentVideoId === extractVideoId(brief.videoUrl)}
        />
      ))}
    </div>
  );
}

function BriefRow({ brief, active }: { brief: RecentBrief; active: boolean }) {
  const [retrying, setRetrying] = useState(false);
  const activeClass = active ? " brief-row-active" : "";

  async function handleRetry() {
    setRetrying(true);
    try {
      const result = await createBrief(brief.videoUrl);
      if (result.status === "completed" && result.briefId) {
        // Cache hit — replace the failed entry with the completed one
        await removeRecentBrief(brief.jobId);
        await addCompletedBrief(result.jobId, brief.videoUrl, brief.videoTitle, result.briefId);
      } else {
        await retryBrief(brief.jobId, result.jobId);
        chrome.runtime.sendMessage({ type: "brief-created" });
      }
    } catch {
      // If retry itself fails, leave the failed state as-is
    } finally {
      setRetrying(false);
    }
  }

  if (brief.status === "failed") {
    return (
      <div className={`brief-row${activeClass}`}>
        <div className="brief-status-dot failed" />
        <div className="brief-info">
          <div className="brief-title">{brief.videoTitle}</div>
          <div className="brief-meta failed-meta">
            {brief.error || "Failed"}
            {active && <span className="brief-current-label"> · This video</span>}
          </div>
        </div>
        <button
          className="retry-btn"
          onClick={handleRetry}
          disabled={retrying}
          title="Retry"
        >
          {retrying ? <SpinnerIcon /> : <RetryIcon />}
        </button>
      </div>
    );
  }

  const statusLabel = brief.status === "processing" ? "Processing..." : "Ready";
  const metaClass = brief.status === "completed" ? " completed-meta" : "";

  const meta = (
    <div className={`brief-meta${metaClass}`}>
      {statusLabel}
      {active && <span className="brief-current-label"> · This video</span>}
    </div>
  );

  if (brief.status === "completed" && brief.briefId) {
    return (
      <a
        href={`${APP_URL}/brief/${brief.briefId}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`brief-row${activeClass}`}
      >
        <div className="brief-status-dot completed" />
        <div className="brief-info">
          <div className="brief-title">{brief.videoTitle}</div>
          {meta}
        </div>
        <ArrowIcon />
      </a>
    );
  }

  return (
    <div className={`brief-row${activeClass}`}>
      <div className={`brief-status-dot ${brief.status}`} />
      <div className="brief-info">
        <div className="brief-title">{brief.videoTitle}</div>
        {meta}
      </div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <line x1="7" y1="3" x2="7" y2="11" />
      <line x1="3" y1="7" x2="11" y2="7" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      className="brief-arrow"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 3l4 4-4 4" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.5 2.5v3.5h3.5" />
      <path d="M2.1 8.5a5 5 0 1 0 .7-4l-1.3 1" />
    </svg>
  );
}

function SpinnerIcon() {
  return <div className="retry-spinner" />;
}
