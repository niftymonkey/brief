// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  CollectionSharePopover,
  type CollectionShareState,
} from "@/components/collections/collection-share-popover";

function shareState(overrides: Partial<CollectionShareState> = {}): CollectionShareState {
  return {
    isShared: false,
    shareUrl: null,
    canManage: true,
    busy: false,
    error: null,
    onEnable: () => {},
    onDisable: () => {},
    ...overrides,
  };
}

describe("CollectionSharePopover", () => {
  afterEach(cleanup);

  it("creates the link on the press that opens the panel", () => {
    const onEnable = vi.fn();
    render(<CollectionSharePopover share={shareState({ onEnable })} />);

    fireEvent.click(screen.getByRole("button", { name: "Share collection" }));

    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it("offers the link and the way to withdraw it once the collection is shared", () => {
    const onDisable = vi.fn();
    render(
      <CollectionSharePopover
        share={shareState({
          isShared: true,
          shareUrl: "https://example.test/c/a-sitting",
          onDisable,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Manage sharing" }));

    expect(screen.getByLabelText("Share link")).toHaveProperty(
      "value",
      "https://example.test/c/a-sitting",
    );
    fireEvent.click(screen.getByRole("button", { name: "stop sharing" }));
    expect(onDisable).toHaveBeenCalledTimes(1);
  });

  it("says nothing to a reader who has neither a link nor the right to make one", () => {
    render(<CollectionSharePopover share={shareState({ canManage: false })} />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("surfaces a failure to create the link where the link would have been", () => {
    render(
      <CollectionSharePopover
        share={shareState({ error: "Could not create a share link." })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Share collection" }));

    expect(screen.getByRole("alert").textContent).toBe("Could not create a share link.");
  });
});
