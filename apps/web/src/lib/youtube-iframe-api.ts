/** How long a load waits for `YT.Player` before it is reported as failed. */
export const API_LOAD_TIMEOUT_MS = 15_000;

const API_SCRIPT_SRC = "https://www.youtube.com/iframe_api";
const API_SCRIPT_SELECTOR = 'script[src*="youtube.com/iframe_api"]';
const API_SCRIPT_FAILURE = "The YouTube player script could not be loaded.";

/**
 * The slice of the page a loader touches. The browser implementation below is the
 * only one that ships; the seam exists so the load's success, failure and retry
 * paths can be exercised without a DOM.
 */
export interface YouTubeIframeApiPage {
  /** True once `YT.Player` is constructible. */
  isApiReady(): boolean;
  /**
   * Registers `callback` on the page's global ready hook, alongside any hook that is
   * already there so several players can wait on one script. Returns the unregister
   * that keeps a retried load from leaving its callback behind.
   */
  whenApiReady(callback: () => void): () => void;
  /**
   * Puts the API script on the page, reporting a load failure to `onFailure`. Returns
   * the disposer that takes the tag back off the page, so a dead script does not make
   * `querySelector` swallow the next attempt.
   */
  ensureScript(onFailure: (message: string) => void): () => void;
}

/**
 * Puts the API script on `doc` and returns the disposer that takes it back off.
 *
 * A tag that is already there is adopted rather than left alone. `querySelector` is what
 * makes a later attempt skip injection, so whichever code path put that tag on the page,
 * a failed attempt has to be able to clear it; otherwise one dead script sends every
 * retry, including the viewer's Try again, straight back to the same timeout.
 *
 * Both the adopted tag and a freshly injected one report a load error to `onFailure`, and
 * the disposer leaves neither the tag nor its listener behind. The adopted tag takes a
 * listener rather than an `onerror` assignment so a hook another code path is waiting on
 * survives. What this cannot see is a tag that already errored before it was adopted:
 * the error event is long past, so that case still waits out `API_LOAD_TIMEOUT_MS`.
 */
export function ensureApiScript(
  doc: Document,
  onFailure: (message: string) => void,
): () => void {
  const reportFailure = () => onFailure(API_SCRIPT_FAILURE);

  const existing = doc.querySelector(API_SCRIPT_SELECTOR);
  if (existing) {
    existing.addEventListener("error", reportFailure);
    return () => {
      existing.removeEventListener("error", reportFailure);
      existing.remove();
    };
  }

  const script = doc.createElement("script");
  script.src = API_SCRIPT_SRC;
  script.async = true;
  script.onerror = reportFailure;
  doc.head.appendChild(script);

  return () => script.remove();
}

function browserPage(): YouTubeIframeApiPage {
  const readyCallbacks = new Set<() => void>();
  let hookInstalled = false;

  return {
    isApiReady: () => Boolean(window.YT?.Player),

    whenApiReady: (callback) => {
      if (!hookInstalled) {
        // One hook fans out to a set that callers can leave, so a page that retries
        // the load a dozen times still holds a single global callback.
        const existingCallback = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          existingCallback?.();
          for (const waiting of [...readyCallbacks]) waiting();
        };
        hookInstalled = true;
      }

      readyCallbacks.add(callback);
      return () => {
        readyCallbacks.delete(callback);
      };
    },

    ensureScript: (onFailure) => ensureApiScript(document, onFailure),
  };
}

/**
 * Builds a loader that resolves once `window.YT.Player` is constructible and
 * rejects when the script errors or the API never arrives. Callers that arrive
 * while a load is in flight share it; a load that resolves stays memoized, and a
 * load that fails is dropped so a later call starts a fresh attempt.
 */
export function createYouTubeIframeApiLoader(
  page: YouTubeIframeApiPage,
  timeoutMs: number = API_LOAD_TIMEOUT_MS,
): () => Promise<void> {
  let inFlight: Promise<void> | null = null;

  return function loadApi(): Promise<void> {
    if (inFlight) return inFlight;

    const attempt = new Promise<void>((resolve, reject) => {
      if (page.isApiReady()) {
        resolve();
        return;
      }

      let settled = false;
      let stopWaiting: (() => void) | null = null;
      let waitUnwanted = false;
      let removeScript: (() => void) | null = null;
      let scriptUnwanted = false;

      const dropWait = () => {
        waitUnwanted = true;
        stopWaiting?.();
      };

      const dropScript = () => {
        scriptUnwanted = true;
        removeScript?.();
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        dropWait();
        resolve();
      };

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        dropWait();
        // The attempt's script is dead whether it errored or never arrived; leaving
        // it on the page would make the next attempt skip injection and time out too.
        dropScript();
        reject(new Error(message));
      };

      const timer = setTimeout(
        () => fail("The YouTube player took too long to load."),
        timeoutMs,
      );

      // Each of these can report its outcome before it returns, which runs `succeed` or
      // `fail` while there is no disposer to call yet, so the disposal each asked for
      // happens on the line after it instead.
      stopWaiting = page.whenApiReady(succeed);
      if (waitUnwanted) stopWaiting();
      removeScript = page.ensureScript(fail);
      if (scriptUnwanted) removeScript();
    });

    inFlight = attempt;
    attempt.catch(() => {
      if (inFlight === attempt) inFlight = null;
    });

    return attempt;
  };
}

/** The page-wide loader every player on the page shares. */
export const loadYouTubeIframeApi = createYouTubeIframeApiLoader(browserPage());
