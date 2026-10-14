"use client";

import { useCallback, useEffect, useEffectEvent, useState, type RefObject } from "react";

/**
 * How an element is filling the screen: handed to the browser's own full screen, drawn
 * over the viewport by the page itself where the browser has no full screen to give,
 * or neither.
 */
export type FullscreenMode = "off" | "native" | "fill";

interface ElementFullscreenOptions {
  /**
   * Told whether the element fills the screen, on every change and once more if the
   * element goes while it does.
   */
  onChange?: (isFullscreen: boolean) => void;
  /** The control that put the element there, which gets focus back when it leaves. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Asks the browser to take `target` full screen. Resolves once it has, rejects if it
 * refuses, and returns null where it has none to offer, which on an iPhone is every
 * element but a bare video.
 */
function requestNativeFullscreen(target: HTMLElement): Promise<void> | null {
  if (document.fullscreenEnabled !== true || typeof target.requestFullscreen !== "function") {
    return null;
  }
  try {
    return target.requestFullscreen();
  } catch (error) {
    return Promise.reject(error);
  }
}

function exitNativeFullscreen(): void {
  if (typeof document.exitFullscreen !== "function") return;
  void document.exitFullscreen().catch(() => {});
}

/**
 * Full screen for one element, with a fallback the browser cannot refuse: where it has
 * no full screen to give, or turns the request down, the element is drawn over the
 * whole viewport instead and the page under it stops scrolling.
 *
 * Neither path moves the element. Full screen is a mode on the node already mounted,
 * which is what lets it hold something that must never remount, like a playing iframe.
 * The browser's mode is read back from its own change event, so leaving through the
 * browser's UI rather than ours lands here too.
 */
export function useElementFullscreen(
  targetRef: RefObject<HTMLElement | null>,
  { onChange, returnFocusRef }: ElementFullscreenOptions = {},
) {
  const [mode, setMode] = useState<FullscreenMode>("off");

  const changeMode = useCallback(
    (next: FullscreenMode) => {
      setMode(next);
      onChange?.(next !== "off");
      // Whatever had focus inside the element is about to go with the mode, so focus
      // goes back where the viewer started rather than falling to the page.
      if (next === "off") returnFocusRef?.current?.focus();
    },
    [onChange, returnFocusRef],
  );

  const enter = useCallback(() => {
    const target = targetRef.current;
    if (!target) return;
    const request = requestNativeFullscreen(target);
    if (!request) {
      changeMode("fill");
      return;
    }
    request.then(
      () => changeMode("native"),
      () => changeMode("fill"),
    );
  }, [changeMode, targetRef]);

  const exit = useCallback(() => {
    if (mode === "native") exitNativeFullscreen();
    changeMode("off");
  }, [changeMode, mode]);

  const toggle = useCallback(() => {
    if (mode === "off") enter();
    else exit();
  }, [enter, exit, mode]);

  const syncWithBrowser = useEffectEvent(() => {
    const isOurs = targetRef.current !== null && document.fullscreenElement === targetRef.current;
    if (isOurs && mode !== "native") changeMode("native");
    if (!isOurs && mode === "native") changeMode("off");
  });

  const release = useEffectEvent(() => {
    if (mode === "off") return;
    if (document.fullscreenElement === targetRef.current) exitNativeFullscreen();
    onChange?.(false);
  });

  useEffect(() => {
    const handleChange = () => syncWithBrowser();
    document.addEventListener("fullscreenchange", handleChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleChange);
      // An element that goes while it fills the screen takes its full screen with it,
      // rather than leaving the page in a mode nothing on it can end any more.
      release();
    };
  }, []);

  useEffect(() => {
    if (mode !== "fill") return;
    // The browser's own full screen answers Escape itself; the page's stand-in has to.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") changeMode("off");
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [changeMode, mode]);

  return { mode, toggle, exit };
}
