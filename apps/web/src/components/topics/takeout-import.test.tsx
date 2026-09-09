// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TakeoutImport, sortTakeoutChannels } from "@/components/topics/takeout-import";
import type { TakeoutChannelInput } from "@/lib/topics";
import type { TakeoutChannel } from "@/lib/takeout-csv";

const HEADER = "Channel Id,Channel Url,Channel Title";

/** A channel id of the shape the export carries, distinct per index. */
function channelId(index: number): string {
  return `UC${String(index).padStart(22, "0")}`;
}

function row(index: number, title: string): string {
  const id = channelId(index);
  return `${id},http://www.youtube.com/channel/${id},${title}`;
}

/**
 * What the component reads off a picked file. jsdom's File carries no `text()`, so
 * a suite hands the reader its text directly.
 */
function pickedFile(name: string, text: string) {
  return { name, text: () => Promise.resolve(text) };
}

function exportOf(titles: string[], extraRows: string[] = []) {
  const rows = titles.map((title, index) => row(index, title));
  return pickedFile("subscriptions.csv", [HEADER, ...rows, ...extraRows].join("\n"));
}

type ImportResult = { ok: true } | { ok: false; error: string };

interface RenderOptions {
  presentChannelIds?: string[];
  onImport?: (channels: TakeoutChannelInput[]) => Promise<ImportResult>;
}

function renderImport({ presentChannelIds = [], onImport }: RenderOptions = {}) {
  const calls: TakeoutChannelInput[][] = [];
  const collect = async (channels: TakeoutChannelInput[]): Promise<ImportResult> => {
    calls.push(channels);
    return { ok: true };
  };
  const handler = onImport ?? collect;
  render(<TakeoutImport presentChannelIds={presentChannelIds} onImport={handler} />);
  return { calls };
}

/** A picked file the browser hands over but cannot read back. */
function unreadableFile(name: string) {
  return { name, text: () => Promise.reject(new Error("could not read")) };
}

function fileInput(): HTMLInputElement {
  const input = screen.getByLabelText(/subscriptions export/i);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("The subscriptions export control is not an input.");
  }
  return input;
}

async function pick(file: { name: string; text: () => Promise<string> }): Promise<void> {
  const input = fileInput();
  // jsdom holds no real selection, so the suite plays the part the browser plays:
  // a `value` carrying the picked path until something clears it. That is what a
  // second pick of the same path depends on.
  let value = `C:\\fakepath\\${file.name}`;
  Object.defineProperty(input, "value", {
    configurable: true,
    get: () => value,
    set: (next: string) => {
      value = next;
    },
  });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

function tickBoxes(): HTMLInputElement[] {
  return screen.getAllByRole("checkbox");
}

function importButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Add / });
}

function channel(channelTitle: string, index: number): TakeoutChannel {
  return {
    channelId: channelId(index),
    channelUrl: `http://www.youtube.com/channel/${channelId(index)}`,
    channelTitle,
  };
}

function titlesOf(channels: TakeoutChannel[]): string[] {
  return channels.map((entry) => entry.channelTitle);
}

function shownTitles(): string[] {
  return screen.getAllByRole("checkbox").map((box) => {
    const label = document.querySelector(`label[for="${box.id}"]`);
    return label?.textContent ?? "";
  });
}

describe("sortTakeoutChannels", () => {
  it("orders alphabetically whatever order the file listed", () => {
    const sorted = sortTakeoutChannels([channel("Zeta", 1), channel("Alpha", 2), channel("Mid", 3)]);

    expect(titlesOf(sorted)).toEqual(["Alpha", "Mid", "Zeta"]);
  });

  it("ignores case when ordering", () => {
    const sorted = sortTakeoutChannels([channel("banana", 1), channel("Apple", 2), channel("ZEBRA", 3)]);

    expect(titlesOf(sorted)).toEqual(["Apple", "banana", "ZEBRA"]);
  });

  it("puts a non-ASCII title where a reader looks for it", () => {
    // U+2024 ONE DOT LEADER, which is what the export actually carries.
    const sorted = sortTakeoutChannels([
      channel("Zeta", 1),
      channel("Theo - t3\u2024gg", 2),
      channel("apple", 3),
    ]);

    expect(titlesOf(sorted)).toEqual(["apple", "Theo - t3\u2024gg", "Zeta"]);
  });

  it("keeps a titleless row last, ordered by its channel id", () => {
    const sorted = sortTakeoutChannels([channel("", 9), channel("Zeta", 1), channel("", 4)]);

    expect(titlesOf(sorted)).toEqual(["Zeta", "", ""]);
    expect(sorted.slice(1).map((entry) => entry.channelId)).toEqual([channelId(4), channelId(9)]);
  });

  it("leaves the caller's array alone", () => {
    const given = [channel("Zeta", 1), channel("Alpha", 2)];
    sortTakeoutChannels(given);

    expect(titlesOf(given)).toEqual(["Zeta", "Alpha"]);
  });
});

describe("TakeoutImport", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("reads the counts of a picked export out loud", async () => {
    renderImport();
    await pick(exportOf(["Theo", "Fireship"], [",,", "  "]));

    expect(screen.getByText(/2 channels found/)).toBeTruthy();
    expect(screen.getByText(/1 row skipped/)).toBeTruthy();
  });

  it("ticks nothing when the export lands", async () => {
    renderImport();
    await pick(exportOf(["Theo", "Fireship"]));

    expect(tickBoxes().every((box) => !box.checked)).toBe(true);
    expect(importButton()).toHaveProperty("disabled", true);
  });

  it("ticks and unticks every row on request", async () => {
    renderImport();
    await pick(exportOf(["Theo", "Fireship", "Primeagen"]));

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(tickBoxes().every((box) => box.checked)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Select none" }));
    expect(tickBoxes().every((box) => !box.checked)).toBe(true);
  });

  it("sends only the ticked rows", async () => {
    const { calls } = renderImport();
    await pick(exportOf(["Theo", "Fireship", "Primeagen"]));

    fireEvent.click(screen.getByLabelText("Fireship"));
    await act(async () => {
      fireEvent.click(importButton());
    });

    expect(calls).toEqual([
      [
        {
          youtubeChannelId: channelId(1),
          channelTitle: "Fireship",
          channelUrl: `http://www.youtube.com/channel/${channelId(1)}`,
        },
      ],
    ]);
  });

  it("marks a channel the topic already holds and leaves it out of select all", async () => {
    const { calls } = renderImport({ presentChannelIds: [channelId(0)] });
    await pick(exportOf(["Theo", "Fireship"]));

    expect(screen.getByText(/already on this topic/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    await act(async () => {
      fireEvent.click(importButton());
    });

    expect(calls[0].map((channel) => channel.channelTitle)).toEqual(["Fireship"]);
  });

  it("clears the ticks once the import lands and says how many were added", async () => {
    renderImport();
    await pick(exportOf(["Theo", "Fireship"]));

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    await act(async () => {
      fireEvent.click(importButton());
    });

    expect(screen.getByText(/Added 2 channels/)).toBeTruthy();
    expect(tickBoxes().every((box) => !box.checked)).toBe(true);
  });

  it("shows what the server said when the import fails", async () => {
    renderImport({ onImport: async () => ({ ok: false, error: "That topic is gone." }) });
    await pick(exportOf(["Theo"]));

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    await act(async () => {
      fireEvent.click(importButton());
    });

    expect(screen.getByText("That topic is gone.")).toBeTruthy();
    expect(screen.queryByText(/Added/)).toBeNull();
  });

  it("names the file it wanted when the columns are wrong", async () => {
    renderImport();
    await pick(pickedFile("watch-history.csv", "Video Id,Time\nabc,2024-01-01"));

    expect(screen.getByRole("alert").textContent).toContain("subscriptions.csv");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("names the file it wanted when the file is empty", async () => {
    renderImport();
    await pick(pickedFile("subscriptions.csv", ""));

    expect(screen.getByRole("alert").textContent).toContain("subscriptions.csv");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("replaces a wrong account's export with the next one picked", async () => {
    const { calls } = renderImport();

    await pick(exportOf(["Old One", "Old Two"]));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));

    await pick(pickedFile("subscriptions.csv", [HEADER, row(7, "Right One")].join("\n")));

    expect(screen.queryByLabelText("Old One")).toBeNull();
    expect(tickBoxes()).toHaveLength(1);
    expect(tickBoxes()[0].checked).toBe(false);

    fireEvent.click(screen.getByLabelText("Right One"));
    await act(async () => {
      fireEvent.click(importButton());
    });

    expect(calls[0].map((channel) => channel.channelTitle)).toEqual(["Right One"]);
  });

  it("clears a rejected file's message once a good export lands", async () => {
    renderImport();

    await pick(pickedFile("watch-history.csv", "Video Id,Time\nabc,2024-01-01"));
    await pick(exportOf(["Theo"]));

    expect(screen.queryByText(/does not look like/)).toBeNull();
    expect(screen.getByLabelText("Theo")).toBeTruthy();
  });

  it("shows the list alphabetically, not in file order", async () => {
    renderImport();
    await pick(exportOf(["Zeta", "apple", "Mid"]));

    expect(shownTitles()).toEqual(["apple", "Mid", "Zeta"]);
  });

  it("keeps an already added row in the same alphabetical run", async () => {
    renderImport({ presentChannelIds: [channelId(1)] });
    await pick(exportOf(["Zeta", "Mid", "apple"]));

    expect(shownTitles()).toEqual(["apple", "Mid", "Zeta"]);
    expect(screen.getByText("Already added")).toBeTruthy();
  });

  it("filters the list on title as a person types, and counts what is shown", async () => {
    renderImport();
    await pick(exportOf(["Matt Pocock", "Fireship", "matthew berman"]));

    fireEvent.change(screen.getByLabelText(/filter/i), { target: { value: "matt" } });

    expect(shownTitles()).toEqual(["Matt Pocock", "matthew berman"]);
    expect(screen.getByText(/2 of 3/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/filter/i), { target: { value: "" } });
    expect(shownTitles()).toHaveLength(3);
  });

  it("keeps a tick made before the filter changed", async () => {
    const { calls } = renderImport();
    await pick(exportOf(["Matt Pocock", "Fireship"]));

    fireEvent.click(screen.getByLabelText("Fireship"));
    fireEvent.change(screen.getByLabelText(/filter/i), { target: { value: "matt" } });

    expect(shownTitles()).toEqual(["Matt Pocock"]);
    await act(async () => {
      fireEvent.click(importButton());
    });

    expect(calls[0].map((entry) => entry.channelTitle)).toEqual(["Fireship"]);
  });

  it("ticks and unticks only the rows the filter is showing", async () => {
    const { calls } = renderImport();
    await pick(exportOf(["Matt Pocock", "Fireship", "matthew berman"]));

    fireEvent.change(screen.getByLabelText(/filter/i), { target: { value: "matt" } });
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.change(screen.getByLabelText(/filter/i), { target: { value: "" } });

    expect(
      shownTitles().filter((_title, index) => tickBoxes()[index].checked),
    ).toEqual(["Matt Pocock", "matthew berman"]);

    fireEvent.change(screen.getByLabelText(/filter/i), { target: { value: "pocock" } });
    fireEvent.click(screen.getByRole("button", { name: "Select none" }));
    fireEvent.change(screen.getByLabelText(/filter/i), { target: { value: "" } });
    await act(async () => {
      fireEvent.click(importButton());
    });

    expect(calls[0].map((entry) => entry.channelTitle)).toEqual(["matthew berman"]);
  });

  it("says so when the filter matches nothing", async () => {
    renderImport();
    await pick(exportOf(["Matt Pocock", "Fireship"]));

    fireEvent.change(screen.getByLabelText(/filter/i), { target: { value: "kurzgesagt" } });

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByText(/No channel in this export matches/)).toBeTruthy();
  });

  it("lets the same file be picked again after a read failure", async () => {
    renderImport();
    await pick(unreadableFile("subscriptions.csv"));

    expect(screen.getByRole("alert").textContent).toContain("Pick the file again");
    expect(fileInput().value).toBe("");
  });

  it("lets a re-export under the same name be picked again after a parse failure", async () => {
    renderImport();
    await pick(pickedFile("subscriptions.csv", "Video Id,Time\nabc,2024-01-01"));

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(fileInput().value).toBe("");
  });

  it("takes an earlier success off screen when a later import fails", async () => {
    let attempt = 0;
    renderImport({
      onImport: async () => {
        attempt += 1;
        return attempt === 1 ? { ok: true } : { ok: false, error: "That topic is gone." };
      },
    });
    await pick(exportOf(["Theo", "Fireship"]));

    fireEvent.click(screen.getByLabelText("Theo"));
    await act(async () => {
      fireEvent.click(importButton());
    });
    expect(screen.getByText(/Added 1 channel/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Fireship"));
    await act(async () => {
      fireEvent.click(importButton());
    });

    expect(screen.getByText("That topic is gone.")).toBeTruthy();
    expect(screen.queryByText(/Added/)).toBeNull();
  });

  it("says the export named no channels rather than offering an empty list", async () => {
    renderImport();
    await pick(pickedFile("subscriptions.csv", HEADER));

    expect(screen.getByText(/no channels/i)).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
