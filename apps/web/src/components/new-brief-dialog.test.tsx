// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NewBriefDialog } from "@/components/new-brief-dialog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));

describe("NewBriefDialog trigger", () => {
  afterEach(() => {
    cleanup();
  });

  it("is named for a screen reader", () => {
    render(<NewBriefDialog />);
    expect(screen.getByRole("button", { name: "New Brief" })).toBeTruthy();
  });

  it("keeps its name once the narrow layout has taken the visible label away", () => {
    // The header hides the label below 340px, where the row has no width for it.
    // The label stays in the tree, so the button a screen reader reaches is the same.
    render(<NewBriefDialog collapseLabelWhenNarrow />);
    expect(screen.getByRole("button", { name: "New Brief" })).toBeTruthy();
  });
});
