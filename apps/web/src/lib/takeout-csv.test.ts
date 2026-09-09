import { describe, expect, it } from "vitest";
import { InvalidTakeoutCsvError, parseTakeoutSubscriptions } from "./takeout-csv";

const HEADER = "Channel Id,Channel Url,Channel Title";

describe("parseTakeoutSubscriptions", () => {
  it("reads the three documented columns off each row", () => {
    const result = parseTakeoutSubscriptions(
      `${HEADER}\nUCbRP3c757lWg9M-U7TyEkXA,http://www.youtube.com/channel/UCbRP3c757lWg9M-U7TyEkXA,Theo`,
    );

    expect(result.channels).toEqual([
      {
        channelId: "UCbRP3c757lWg9M-U7TyEkXA",
        channelUrl: "http://www.youtube.com/channel/UCbRP3c757lWg9M-U7TyEkXA",
        channelTitle: "Theo",
      },
    ]);
    expect(result.skippedRows).toBe(0);
  });
});

describe("quoted fields", () => {
  it("keeps a comma inside a quoted title", () => {
    const result = parseTakeoutSubscriptions(
      `${HEADER}\nUC1,http://x/UC1,"Wong, Kim and Watts"`,
    );

    expect(result.channels[0].channelTitle).toBe("Wong, Kim and Watts");
  });

  it("unescapes a doubled double quote inside a quoted title", () => {
    const result = parseTakeoutSubscriptions(
      `${HEADER}\nUC1,http://x/UC1,"The ""Real"" Channel"`,
    );

    expect(result.channels[0].channelTitle).toBe('The "Real" Channel');
  });
});

describe("line endings and blank lines", () => {
  it("reads CRLF rows without dragging the carriage return into a field", () => {
    const result = parseTakeoutSubscriptions(
      `${HEADER}\r\nUC1,http://x/UC1,One\r\nUC2,http://x/UC2,Two\r\n`,
    );

    expect(result.channels).toEqual([
      { channelId: "UC1", channelUrl: "http://x/UC1", channelTitle: "One" },
      { channelId: "UC2", channelUrl: "http://x/UC2", channelTitle: "Two" },
    ]);
  });

  it("ignores a trailing newline rather than reading an extra row", () => {
    const result = parseTakeoutSubscriptions(`${HEADER}\nUC1,http://x/UC1,One\n`);

    expect(result.channels).toHaveLength(1);
    expect(result.skippedRows).toBe(0);
  });

  it("ignores blank lines between rows", () => {
    const result = parseTakeoutSubscriptions(
      `${HEADER}\n\nUC1,http://x/UC1,One\n\n\nUC2,http://x/UC2,Two\n`,
    );

    expect(result.channels).toHaveLength(2);
    expect(result.skippedRows).toBe(0);
  });
});

describe("column matching", () => {
  it("preserves non-ASCII title characters exactly", () => {
    const title = "Theo - t3․gg";
    const result = parseTakeoutSubscriptions(
      `${HEADER}\nUCbRP3c757lWg9M-U7TyEkXA,http://x/UC1,${title}`,
    );

    expect(result.channels[0].channelTitle).toBe(title);
    expect(result.channels[0].channelTitle).not.toBe("Theo - t3.gg");
  });

  it("ignores columns it does not need", () => {
    const result = parseTakeoutSubscriptions(
      `${HEADER},Subscriber Count\nUC1,http://x/UC1,One,1234`,
    );

    expect(result.channels).toEqual([
      { channelId: "UC1", channelUrl: "http://x/UC1", channelTitle: "One" },
    ]);
  });

  it("matches the columns it needs by header name, not by position", () => {
    const result = parseTakeoutSubscriptions(
      "Channel Title,Channel Id,Channel Url\nOne,UC1,http://x/UC1",
    );

    expect(result.channels).toEqual([
      { channelId: "UC1", channelUrl: "http://x/UC1", channelTitle: "One" },
    ]);
  });
});

describe("files that are not a subscriptions export", () => {
  it("rejects an empty file", () => {
    expect(() => parseTakeoutSubscriptions("")).toThrow(InvalidTakeoutCsvError);
  });

  it("reads a file of nothing but whitespace as empty", () => {
    let thrown: InvalidTakeoutCsvError | null = null;
    try {
      parseTakeoutSubscriptions("\n\r\n  \n");
    } catch (error) {
      thrown = error instanceof InvalidTakeoutCsvError ? error : null;
    }

    expect(thrown?.reason).toBe("empty");
  });

  it("tells an empty file apart from a file with the wrong columns", () => {
    const empty = (() => {
      try {
        parseTakeoutSubscriptions("");
        return null;
      } catch (error) {
        return error instanceof InvalidTakeoutCsvError ? error : null;
      }
    })();

    expect(empty?.reason).toBe("empty");
  });

  it("rejects a header that is missing the columns it needs, naming them", () => {
    let thrown: InvalidTakeoutCsvError | null = null;
    try {
      parseTakeoutSubscriptions("Video Id,Video Title\nabc,Some video");
    } catch (error) {
      thrown = error instanceof InvalidTakeoutCsvError ? error : null;
    }

    expect(thrown?.reason).toBe("missing-columns");
    expect(thrown?.message).toContain("Channel Id");
    expect(thrown?.message).toContain("subscriptions");
  });

  it("accepts a header that only carries some of the columns it needs", () => {
    expect(() => parseTakeoutSubscriptions("Channel Id,Channel Url\nUC1,http://x/UC1")).toThrow(
      InvalidTakeoutCsvError,
    );
  });

  it("accepts a real export that holds a header and no rows", () => {
    const result = parseTakeoutSubscriptions(`${HEADER}\n`);

    expect(result.channels).toEqual([]);
    expect(result.skippedRows).toBe(0);
  });
});

describe("whitespace", () => {
  it("trims surrounding whitespace off every field", () => {
    const result = parseTakeoutSubscriptions(
      `${HEADER}\n  UC1 , http://x/UC1 ,  One Two  `,
    );

    expect(result.channels).toEqual([
      { channelId: "UC1", channelUrl: "http://x/UC1", channelTitle: "One Two" },
    ]);
  });

  it("matches header names that carry padding", () => {
    const result = parseTakeoutSubscriptions(
      "Channel Id , Channel Url , Channel Title\nUC1,http://x/UC1,One",
    );

    expect(result.channels).toHaveLength(1);
  });

  it("matches header names past a byte order mark", () => {
    const result = parseTakeoutSubscriptions(`﻿${HEADER}\nUC1,http://x/UC1,One`);

    expect(result.channels).toEqual([
      { channelId: "UC1", channelUrl: "http://x/UC1", channelTitle: "One" },
    ]);
  });
});

describe("rows it cannot use", () => {
  it("skips a row with no channel id and counts it", () => {
    const result = parseTakeoutSubscriptions(
      `${HEADER}\nUC1,http://x/UC1,One\n,http://x/nothing,Nameless\nUC2,http://x/UC2,Two`,
    );

    expect(result.channels.map((channel) => channel.channelId)).toEqual(["UC1", "UC2"]);
    expect(result.skippedRows).toBe(1);
  });

  it("skips a row whose channel id is only whitespace", () => {
    const result = parseTakeoutSubscriptions(`${HEADER}\n   ,http://x/UC1,One`);

    expect(result.channels).toEqual([]);
    expect(result.skippedRows).toBe(1);
  });

  it("skips a short row that stops before the channel id column", () => {
    const result = parseTakeoutSubscriptions(
      "Channel Url,Channel Title,Channel Id\nhttp://x/UC1,One",
    );

    expect(result.channels).toEqual([]);
    expect(result.skippedRows).toBe(1);
  });

  it("keeps a row whose url or title is empty, since the id is what identifies it", () => {
    const result = parseTakeoutSubscriptions(`${HEADER}\nUC1,,`);

    expect(result.channels).toEqual([
      { channelId: "UC1", channelUrl: "", channelTitle: "" },
    ]);
    expect(result.skippedRows).toBe(0);
  });
});

describe("duplicate channels", () => {
  it("keeps the first occurrence of a repeated channel id", () => {
    const result = parseTakeoutSubscriptions(
      `${HEADER}\nUC1,http://x/first,First\nUC1,http://x/second,Second\n`,
    );

    expect(result.channels).toEqual([
      { channelId: "UC1", channelUrl: "http://x/first", channelTitle: "First" },
    ]);
  });

  it("counts a duplicate among the skipped rows, so the tally adds up", () => {
    const result = parseTakeoutSubscriptions(
      `${HEADER}\nUC1,http://x/UC1,One\nUC1,http://x/UC1,One again\n,http://x/none,Nameless\nUC2,http://x/UC2,Two`,
    );

    expect(result.channels).toHaveLength(2);
    expect(result.skippedRows).toBe(2);
  });
});

describe("blank lines against empty rows", () => {
  it("counts a row of empty fields, which is a row and not a blank line", () => {
    const result = parseTakeoutSubscriptions(`${HEADER}\nUC1,http://x/UC1,One\n,,\n`);

    expect(result.channels).toHaveLength(1);
    expect(result.skippedRows).toBe(1);
  });
});
