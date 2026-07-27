import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createYouTubeIframeApiLoader,
  ensureApiScript,
  type YouTubeIframeApiPage,
} from "./youtube-iframe-api";

interface FakePageOptions {
  /** `YT.Player` is constructible before the loader starts. */
  apiAlreadyReady?: boolean;
  /** `ensureScript` reports its failure before it returns, as a cached 404 would. */
  failScriptImmediately?: boolean;
  /** `whenApiReady` fires the callback before it returns, as a hook already armed would. */
  reportReadyImmediately?: boolean;
}

interface FakePage {
  page: YouTubeIframeApiPage;
  /** Number of times the loader asked for the API script. */
  scriptRequests: () => number;
  /** Callbacks still waiting on the page's ready hook. */
  pendingReadyCallbacks: () => number;
  /** Number of injected script tags the loader has taken back off the page. */
  scriptRemovals: () => number;
  /** Fires the page's ready hook, as the real script does once YT is constructible. */
  reportReady: () => void;
  /** Fires the script's error hook. */
  reportScriptError: () => void;
}

function createFakePage(options: FakePageOptions = {}): FakePage {
  const readyCallbacks = new Set<() => void>();
  const failureCallbacks: Array<(message: string) => void> = [];
  let scriptRequests = 0;
  let scriptRemovals = 0;

  return {
    page: {
      isApiReady: () => options.apiAlreadyReady === true,
      whenApiReady: (callback) => {
        readyCallbacks.add(callback);
        if (options.reportReadyImmediately) callback();
        return () => readyCallbacks.delete(callback);
      },
      ensureScript: (onFailure) => {
        scriptRequests += 1;
        failureCallbacks.push(onFailure);
        if (options.failScriptImmediately) onFailure("The script did not load.");
        return () => {
          scriptRemovals += 1;
        };
      },
    },
    scriptRequests: () => scriptRequests,
    pendingReadyCallbacks: () => readyCallbacks.size,
    scriptRemovals: () => scriptRemovals,
    reportReady: () => {
      for (const callback of [...readyCallbacks]) callback();
    },
    reportScriptError: () => {
      for (const callback of failureCallbacks) callback("The script did not load.");
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createYouTubeIframeApiLoader", () => {
  it("resolves once the page reports the API ready", async () => {
    const fake = createFakePage();
    const loadApi = createYouTubeIframeApiLoader(fake.page);

    const loading = loadApi();
    fake.reportReady();

    await expect(loading).resolves.toBeUndefined();
    expect(fake.scriptRequests()).toBe(1);
  });

  it("resolves without a script when the API is already on the page", async () => {
    const fake = createFakePage({ apiAlreadyReady: true });
    const loadApi = createYouTubeIframeApiLoader(fake.page);

    await expect(loadApi()).resolves.toBeUndefined();
    expect(fake.scriptRequests()).toBe(0);
  });

  it("shares one script between callers that arrive while the load is in flight", async () => {
    const fake = createFakePage();
    const loadApi = createYouTubeIframeApiLoader(fake.page);

    const first = loadApi();
    const second = loadApi();
    fake.reportReady();

    await Promise.all([first, second]);
    expect(fake.scriptRequests()).toBe(1);
  });

  it("keeps a finished load memoized", async () => {
    const fake = createFakePage();
    const loadApi = createYouTubeIframeApiLoader(fake.page);

    const loading = loadApi();
    fake.reportReady();
    await loading;

    await expect(loadApi()).resolves.toBeUndefined();
    expect(fake.scriptRequests()).toBe(1);
  });

  it("rejects when the script fails to load", async () => {
    const fake = createFakePage();
    const loadApi = createYouTubeIframeApiLoader(fake.page);

    const loading = loadApi();
    const rejects = expect(loading).rejects.toThrow("The script did not load.");
    fake.reportScriptError();

    await rejects;
  });

  it("rejects when the API never becomes ready", async () => {
    vi.useFakeTimers();
    const fake = createFakePage();
    const loadApi = createYouTubeIframeApiLoader(fake.page, 5_000);

    const loading = loadApi();
    const rejects = expect(loading).rejects.toThrow(/too long/);
    await vi.advanceTimersByTimeAsync(5_000);

    await rejects;
  });

  it("lets a later caller retry after a failed load", async () => {
    const fake = createFakePage();
    const loadApi = createYouTubeIframeApiLoader(fake.page);

    const failing = loadApi();
    const rejects = expect(failing).rejects.toThrow();
    fake.reportScriptError();
    await rejects;

    const retry = loadApi();
    expect(fake.scriptRequests()).toBe(2);
    fake.reportReady();
    await expect(retry).resolves.toBeUndefined();
  });

  it("stops listening on the ready hook once a load resolves", async () => {
    const fake = createFakePage();
    const loadApi = createYouTubeIframeApiLoader(fake.page);

    const loading = loadApi();
    fake.reportReady();
    await loading;

    expect(fake.pendingReadyCallbacks()).toBe(0);
  });

  it("leaves no ready listener behind for each attempt that fails", async () => {
    vi.useFakeTimers();
    const fake = createFakePage();
    const loadApi = createYouTubeIframeApiLoader(fake.page, 5_000);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const failing = loadApi();
      const rejects = expect(failing).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(5_000);
      await rejects;
    }

    expect(fake.pendingReadyCallbacks()).toBe(0);
  });

  it("takes the injected script back off the page when the load times out", async () => {
    vi.useFakeTimers();
    const fake = createFakePage();
    const loadApi = createYouTubeIframeApiLoader(fake.page, 5_000);

    const loading = loadApi();
    const rejects = expect(loading).rejects.toThrow(/too long/);
    await vi.advanceTimersByTimeAsync(5_000);
    await rejects;

    expect(fake.scriptRemovals()).toBe(1);
  });

  it("leaves the script in place on the load that succeeds", async () => {
    const fake = createFakePage();
    const loadApi = createYouTubeIframeApiLoader(fake.page);

    const loading = loadApi();
    fake.reportReady();
    await loading;

    expect(fake.scriptRemovals()).toBe(0);
  });

  it("stops waiting on the timeout once the load resolves", async () => {
    vi.useFakeTimers();
    const fake = createFakePage();
    const loadApi = createYouTubeIframeApiLoader(fake.page, 5_000);

    const loading = loadApi();
    expect(vi.getTimerCount()).toBe(1);
    fake.reportReady();
    await loading;

    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no ready listener behind when whenApiReady calls back before it returns", async () => {
    const fake = createFakePage({ reportReadyImmediately: true });
    const loadApi = createYouTubeIframeApiLoader(fake.page);

    await expect(loadApi()).resolves.toBeUndefined();

    expect(fake.pendingReadyCallbacks()).toBe(0);
  });

  it("takes the script off the page when ensureScript fails before it returns", async () => {
    const fake = createFakePage({ failScriptImmediately: true });
    const loadApi = createYouTubeIframeApiLoader(fake.page);

    await expect(loadApi()).rejects.toThrow("The script did not load.");

    expect(fake.scriptRemovals()).toBe(1);
  });
});

/** A script tag as `ensureApiScript` uses one, with the page bookkeeping around it. */
interface FakeScript {
  src: string;
  async: boolean;
  onerror: (() => void) | null;
  errorListeners: Set<() => void>;
  addEventListener: (type: string, handler: () => void) => void;
  removeEventListener: (type: string, handler: () => void) => void;
  remove: () => void;
}

interface FakeDocument {
  document: Document;
  /** Tags matching the API script selector that are on the page right now. */
  scriptsOnPage: () => number;
  /** Tags this document created and appended, as opposed to ones it started with. */
  injections: () => number;
  /** Fires the error hook of the tag most recently put on the page. */
  reportScriptError: () => void;
  /** Error handlers registered as listeners on the tag most recently put on the page. */
  errorListeners: () => number;
  /** Puts an `onerror` on the tag the page started with, as another code path would. */
  setForeignErrorHook: (handler: () => void) => void;
}

/**
 * A stand-in for the parts of `Document` the script injector touches, so the retry path
 * can be exercised in this file's node environment. The cast is the seam between the
 * stub and the DOM type the injector is written against; nothing else here needs one.
 */
function createFakeDocument(existingScripts = 0): FakeDocument {
  const scripts: FakeScript[] = [];
  // Retained after removal so a disposer's listener cleanup is still observable.
  const everOnPage: FakeScript[] = [];
  let injections = 0;

  function createScript(): FakeScript {
    const script: FakeScript = {
      src: "",
      async: false,
      onerror: null,
      errorListeners: new Set<() => void>(),
      addEventListener: (type, handler) => {
        if (type === "error") script.errorListeners.add(handler);
      },
      removeEventListener: (type, handler) => {
        if (type === "error") script.errorListeners.delete(handler);
      },
      remove: () => {
        const at = scripts.indexOf(script);
        if (at >= 0) scripts.splice(at, 1);
      },
    };
    return script;
  }

  for (let index = 0; index < existingScripts; index += 1) {
    const script = createScript();
    script.src = "https://www.youtube.com/iframe_api";
    scripts.push(script);
    everOnPage.push(script);
  }

  const fake = {
    querySelector: (selectors: string) =>
      selectors.includes("iframe_api") ? (scripts[0] ?? null) : null,
    createElement: () => createScript(),
    head: {
      appendChild: (node: FakeScript) => {
        injections += 1;
        scripts.push(node);
        everOnPage.push(node);
        return node;
      },
    },
  };

  return {
    document: fake as unknown as Document,
    scriptsOnPage: () => scripts.length,
    injections: () => injections,
    reportScriptError: () => {
      const script = scripts.at(-1);
      script?.onerror?.();
      for (const listener of [...(script?.errorListeners ?? [])]) listener();
    },
    errorListeners: () => everOnPage.at(-1)?.errorListeners.size ?? 0,
    setForeignErrorHook: (handler) => {
      const script = scripts[0];
      if (script) script.onerror = handler;
    },
  };
}

describe("ensureApiScript", () => {
  it("puts the API script on a page that has none", () => {
    const fake = createFakeDocument();

    ensureApiScript(fake.document, () => {});

    expect(fake.injections()).toBe(1);
    expect(fake.scriptsOnPage()).toBe(1);
  });

  it("reports a script that fails to load", () => {
    const fake = createFakeDocument();
    const failures: string[] = [];

    ensureApiScript(fake.document, (message) => failures.push(message));
    fake.reportScriptError();

    expect(failures).toHaveLength(1);
  });

  it("takes its own script back off the page", () => {
    const fake = createFakeDocument();

    ensureApiScript(fake.document, () => {})();

    expect(fake.scriptsOnPage()).toBe(0);
  });

  it("adopts a script another code path already put on the page", () => {
    const fake = createFakeDocument(1);

    ensureApiScript(fake.document, () => {})();

    expect(fake.injections()).toBe(0);
    expect(fake.scriptsOnPage()).toBe(0);
  });

  it("reports an adopted script that then fails to load", () => {
    const fake = createFakeDocument(1);
    const failures: string[] = [];

    ensureApiScript(fake.document, (message) => failures.push(message));
    fake.reportScriptError();

    expect(failures).toHaveLength(1);
  });

  it("leaves no failure handler behind on a script it adopted", () => {
    const fake = createFakeDocument(1);

    ensureApiScript(fake.document, () => {})();

    expect(fake.errorListeners()).toBe(0);
  });

  it("keeps the failure hook another code path put on an adopted script", () => {
    const fake = createFakeDocument(1);
    let foreignFailures = 0;
    fake.setForeignErrorHook(() => {
      foreignFailures += 1;
    });

    ensureApiScript(fake.document, () => {});
    fake.reportScriptError();

    expect(foreignFailures).toBe(1);
  });

  it("lets the attempt after a foreign script was cleared inject a fresh one", () => {
    const fake = createFakeDocument(1);

    ensureApiScript(fake.document, () => {})();
    ensureApiScript(fake.document, () => {});

    expect(fake.injections()).toBe(1);
    expect(fake.scriptsOnPage()).toBe(1);
  });
});

