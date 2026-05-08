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
      },
    ],
  },
};

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
