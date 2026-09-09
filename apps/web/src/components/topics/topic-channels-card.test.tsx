// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TopicChannelsCard } from "@/components/topics/topic-channels-card";
import type { TopicChannel } from "@/lib/topics";

const actions = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
  importChannels: vi.fn(),
}));

vi.mock("@/app/(app)/topics/actions", () => ({
  addTopicChannelAction: actions.add,
  removeTopicChannelAction: actions.remove,
  importTopicChannelsAction: actions.importChannels,
}));

const CHANNEL_ID = "UC0123456789abcdefghijkl";

function existingChannel(): TopicChannel {
  return {
    id: "channel-1",
    youtubeChannelId: CHANNEL_ID,
    channelTitle: "Fireship",
    channelUrl: `http://www.youtube.com/channel/${CHANNEL_ID}`,
    addedVia: "manual",
  };
}

function addButton(): HTMLElement {
  return screen.getByRole("button", { name: "Add" });
}

function removeButton(): HTMLElement {
  return screen.getByRole("button", { name: "Remove Fireship" });
}

describe("TopicChannelsCard when the request itself fails", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("frees the Add control and says so rather than spinning forever", async () => {
    actions.add.mockRejectedValue(new Error("network down"));
    render(<TopicChannelsCard topicId="topic-1" channels={[]} editable />);

    fireEvent.change(screen.getByLabelText(/add a channel/i), {
      target: { value: CHANNEL_ID },
    });
    await act(async () => {
      fireEvent.click(addButton());
    });

    expect(screen.getByRole("alert").textContent).toContain("Could not add that channel");
    expect(addButton()).toHaveProperty("disabled", false);
  });

  it("frees the Remove control and says so rather than spinning forever", async () => {
    actions.remove.mockRejectedValue(new Error("network down"));
    render(<TopicChannelsCard topicId="topic-1" channels={[existingChannel()]} editable />);

    await act(async () => {
      fireEvent.click(removeButton());
    });

    expect(screen.getByRole("alert").textContent).toContain("Could not remove that channel");
    expect(removeButton()).toHaveProperty("disabled", false);
  });

  it("still reports a refusal the action handed back", async () => {
    actions.remove.mockResolvedValue({ ok: false, error: "That topic is gone." });
    render(<TopicChannelsCard topicId="topic-1" channels={[existingChannel()]} editable />);

    await act(async () => {
      fireEvent.click(removeButton());
    });

    expect(screen.getByText("That topic is gone.")).toBeTruthy();
    expect(removeButton()).toHaveProperty("disabled", false);
  });
});
