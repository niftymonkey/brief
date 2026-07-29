// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SharedCollection } from "@/components/collections/shared-collection";
import {
  FakeYouTubePlayer,
  VIDEO_A,
  VIDEO_FACTS,
  installFakeYouTubePlayer,
  livePlayer,
  makeCollection,
  playFor,
  settle,
  uninstallFakeYouTubePlayer,
} from "@/test/collection-playback-harness";

vi.mock("@/lib/youtube-iframe-api", () => ({
  loadYouTubeIframeApi: () => Promise.resolve(),
}));

function renderShared() {
  return render(
    <SharedCollection
      collection={makeCollection()}
      videoFacts={VIDEO_FACTS}
      updatedLabel="today"
    />,
  );
}

describe("SharedCollection playback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installFakeYouTubePlayer();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    uninstallFakeYouTubePlayer();
  });

  it("restarts the sitting from the top while one is already running", async () => {
    renderShared();

    fireEvent.click(screen.getByRole("button", { name: /Play the whole collection/ }));
    await settle();
    await settle();

    await playFor(12);
    expect(screen.getByText("2 of 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Play from the top" }));
    await settle();
    await settle();

    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(livePlayer().loads).toEqual([{ kind: "load", videoId: VIDEO_A, toSec: 0 }]);
    expect(FakeYouTubePlayer.instances).toHaveLength(2);
  });
});
