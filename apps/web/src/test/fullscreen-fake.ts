import { act } from "@testing-library/react";
import { vi } from "vitest";

/**
 * The browser's Fullscreen API, which jsdom does not implement at all. A suite that
 * never installs it is a browser without one, the way an iPhone is for anything but a
 * video element, so the CSS fallback is what it exercises by default.
 */
let fullscreenElement: Element | null = null;

function setFullscreenElement(element: Element | null): void {
  fullscreenElement = element;
  document.dispatchEvent(new Event("fullscreenchange"));
}

/**
 * Gives every element a `requestFullscreen` that behaves as `request` says. The
 * returned mock records which element each call was made on, in `mock.contexts`.
 */
export function installNativeFullscreen(
  request: (this: HTMLElement) => Promise<void> = function grant() {
    setFullscreenElement(this);
    return Promise.resolve();
  },
) {
  const requestFullscreen = vi.fn(request);
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => true });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    writable: true,
    value: vi.fn(() => {
      setFullscreenElement(null);
      return Promise.resolve();
    }),
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    writable: true,
    value: requestFullscreen,
  });
  return requestFullscreen;
}

export function uninstallNativeFullscreen(): void {
  fullscreenElement = null;
  Reflect.deleteProperty(document, "fullscreenEnabled");
  Reflect.deleteProperty(document, "fullscreenElement");
  Reflect.deleteProperty(document, "exitFullscreen");
  Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
}

/**
 * Makes the installed full screen leave the way a real browser does: `exitFullscreen`
 * hands the page back on a later task rather than at once, and until it has, nothing
 * outside the full screen element can take focus.
 */
export function leaveNativeFullscreenLikeABrowser(): void {
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    writable: true,
    value: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          window.setTimeout(() => {
            setFullscreenElement(null);
            resolve();
          }, 0);
        }),
    ),
  });
  const focus = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function focusOutsideRefused(
    this: HTMLElement,
    options?: FocusOptions,
  ) {
    if (fullscreenElement !== null && !fullscreenElement.contains(this)) return;
    focus.call(this, options);
  });
}

/** The viewer leaving full screen through the browser's own UI rather than ours. */
export function leaveNativeFullscreenFromBrowser(): void {
  act(() => setFullscreenElement(null));
}
