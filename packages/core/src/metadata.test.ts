import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMetadata } from "./metadata";

const videosListMock = vi.fn();
const commentThreadsListMock = vi.fn();

vi.mock("@googleapis/youtube", () => ({
  youtube: () => ({
    videos: { list: videosListMock },
    commentThreads: { list: commentThreadsListMock },
  }),
}));

afterEach(() => {
  videosListMock.mockReset();
  commentThreadsListMock.mockReset();
});

const VID = "dQw4w9WgXcQ";

const successPayload = {
  data: {
    items: [
      {
        snippet: {
          title: "Never Gonna Give You Up",
          channelTitle: "Rick Astley",
          channelId: "UC1",
          publishedAt: "2009-10-25T07:57:33Z",
          description: "Music video",
        },
        contentDetails: { duration: "PT3M33S" },
        player: { embedWidth: "8192", embedHeight: "4608" },
      },
    ],
  },
};

/** One `videos.list` payload carrying exactly the player block under test. */
function payloadWithPlayer(player: unknown) {
  return {
    data: {
      items: [
        {
          ...successPayload.data.items[0],
          player,
        },
      ],
    },
  };
}

async function aspectRatioFrom(player: unknown): Promise<number | null | undefined> {
  videosListMock.mockResolvedValue(payloadWithPlayer(player));
  commentThreadsListMock.mockResolvedValue({ data: { items: [] } });
  const result = await fetchMetadata(VID, { youtubeApiKey: "key" });
  if (result.kind !== "ok") throw new Error(`Expected ok metadata, got ${result.kind}`);
  return result.metadata.aspectRatio;
}

describe("fetchMetadata", () => {
  it("returns ok with full metadata on success", async () => {
    videosListMock.mockResolvedValue(successPayload);
    commentThreadsListMock.mockResolvedValue({
      data: {
        items: [
          {
            snippet: {
              topLevelComment: {
                snippet: { textOriginal: "Pinned comment text" },
              },
            },
          },
        ],
      },
    });

    const result = await fetchMetadata(VID, { youtubeApiKey: "key" });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.metadata).toEqual({
        videoId: VID,
        title: "Never Gonna Give You Up",
        channelTitle: "Rick Astley",
        channelId: "UC1",
        duration: "PT3M33S",
        publishedAt: "2009-10-25T07:57:33Z",
        description: "Music video",
        pinnedComment: "Pinned comment text",
        aspectRatio: 1.7778,
      });
    }
  });

  it("returns ok with pinnedComment undefined when comment fetch fails", async () => {
    videosListMock.mockResolvedValue(successPayload);
    commentThreadsListMock.mockRejectedValue(new Error("comments disabled"));

    const result = await fetchMetadata(VID, { youtubeApiKey: "key" });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.metadata.pinnedComment).toBeUndefined();
    }
  });

  it("returns ok with pinnedComment undefined when no items returned", async () => {
    videosListMock.mockResolvedValue(successPayload);
    commentThreadsListMock.mockResolvedValue({ data: { items: [] } });

    const result = await fetchMetadata(VID, { youtubeApiKey: "key" });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.metadata.pinnedComment).toBeUndefined();
    }
  });

  it("returns unavailable: video-not-found when items empty", async () => {
    videosListMock.mockResolvedValue({ data: { items: [] } });

    const result = await fetchMetadata(VID, { youtubeApiKey: "key" });
    expect(result.kind).toBe("unavailable");
    if (result.kind === "unavailable") {
      expect(result.reason).toBe("video-not-found");
    }
  });

  it("maps 400 error to invalid-id", async () => {
    const err = Object.assign(new Error("Bad Request"), { code: 400 });
    videosListMock.mockRejectedValue(err);

    const result = await fetchMetadata(VID, { youtubeApiKey: "key" });
    expect(result.kind).toBe("unavailable");
    if (result.kind === "unavailable") {
      expect(result.reason).toBe("invalid-id");
    }
  });

  it("maps 403 quota error to quota-exceeded", async () => {
    const err = Object.assign(new Error("quota exceeded"), { code: 403 });
    videosListMock.mockRejectedValue(err);

    const result = await fetchMetadata(VID, { youtubeApiKey: "key" });
    expect(result.kind).toBe("unavailable");
    if (result.kind === "unavailable") {
      expect(result.reason).toBe("quota-exceeded");
    }
  });

  it("maps 403 non-quota error to api-key-invalid", async () => {
    const err = Object.assign(new Error("Forbidden: bad key"), { code: 403 });
    videosListMock.mockRejectedValue(err);

    const result = await fetchMetadata(VID, { youtubeApiKey: "key" });
    expect(result.kind).toBe("unavailable");
    if (result.kind === "unavailable") {
      expect(result.reason).toBe("api-key-invalid");
    }
  });

  it("maps 404 to video-not-found", async () => {
    const err = Object.assign(new Error("Not Found"), { code: 404 });
    videosListMock.mockRejectedValue(err);

    const result = await fetchMetadata(VID, { youtubeApiKey: "key" });
    expect(result.kind).toBe("unavailable");
    if (result.kind === "unavailable") {
      expect(result.reason).toBe("video-not-found");
    }
  });

  it("maps unknown thrown error to transient", async () => {
    videosListMock.mockRejectedValue(new Error("ECONNRESET"));

    const result = await fetchMetadata(VID, { youtubeApiKey: "key" });
    expect(result.kind).toBe("transient");
  });

  it("returns invalid-id when input does not parse to a video id", async () => {
    const result = await fetchMetadata("garbage!!!!", { youtubeApiKey: "key" });
    expect(result.kind).toBe("unavailable");
    if (result.kind === "unavailable") {
      expect(result.reason).toBe("invalid-id");
    }
    expect(videosListMock).not.toHaveBeenCalled();
  });

  it("accepts a YouTube URL and extracts the id", async () => {
    videosListMock.mockResolvedValue(successPayload);
    commentThreadsListMock.mockResolvedValue({ data: { items: [] } });

    const result = await fetchMetadata(
      `https://www.youtube.com/watch?v=${VID}`,
      { youtubeApiKey: "key" }
    );
    expect(result.kind).toBe("ok");
    expect(videosListMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: [VID] })
    );
  });
});

describe("fetchMetadata aspect ratio", () => {
  it("asks for the player part and a max width, which is what makes YouTube report dimensions", async () => {
    await aspectRatioFrom({ embedWidth: "8192", embedHeight: "4608" });

    const request = videosListMock.mock.calls[0][0];
    expect(request.part).toContain("player");
    expect(request.maxWidth).toBe(8192);
  });

  it("derives a landscape ratio from the reported embed dimensions", async () => {
    expect(await aspectRatioFrom({ embedWidth: "8192", embedHeight: "4608" })).toBe(1.7778);
  });

  it("derives a vertical ratio for a Short rather than flattening it to landscape", async () => {
    expect(await aspectRatioFrom({ embedWidth: "8192", embedHeight: "14564" })).toBe(0.5625);
  });

  it("derives a 4:3 ratio for archive footage instead of rounding it to 16:9", async () => {
    expect(await aspectRatioFrom({ embedWidth: "1600", embedHeight: "1200" })).toBe(1.3333);
  });

  it("reads dimensions that arrive as numbers as well as the strings the API sends", async () => {
    expect(await aspectRatioFrom({ embedWidth: 8192, embedHeight: 4608 })).toBe(1.7778);
  });

  it("answers null when the response carries no player block at all", async () => {
    expect(await aspectRatioFrom(undefined)).toBeNull();
  });

  it("answers null when the player block reports no dimensions", async () => {
    expect(await aspectRatioFrom({ embedHtml: "<iframe></iframe>" })).toBeNull();
    expect(await aspectRatioFrom({ embedWidth: null, embedHeight: null })).toBeNull();
    expect(await aspectRatioFrom({ embedWidth: "8192" })).toBeNull();
    expect(await aspectRatioFrom({ embedHeight: "4608" })).toBeNull();
  });

  it("answers null rather than Infinity when the reported height is zero", async () => {
    expect(await aspectRatioFrom({ embedWidth: "8192", embedHeight: "0" })).toBeNull();
  });

  it("answers null for dimensions that are zero, negative, or not numbers", async () => {
    const unusable = [
      { embedWidth: "0", embedHeight: "4608" },
      { embedWidth: "-8192", embedHeight: "4608" },
      { embedWidth: "8192", embedHeight: "-4608" },
      { embedWidth: "wide", embedHeight: "tall" },
      { embedWidth: "", embedHeight: "" },
      { embedWidth: true, embedHeight: false },
      { embedWidth: {}, embedHeight: [] },
      { embedWidth: Number.NaN, embedHeight: 4608 },
      { embedWidth: Number.POSITIVE_INFINITY, embedHeight: 4608 },
    ];
    for (const player of unusable) {
      expect(await aspectRatioFrom(player)).toBeNull();
    }
  });
});
