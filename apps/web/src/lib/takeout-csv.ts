/** One subscribed channel as the export describes it. */
export interface TakeoutChannel {
  channelId: string;
  channelUrl: string;
  channelTitle: string;
}

/**
 * Why a file could not be read as a subscriptions export. Both reasons mean the
 * person picked the wrong file, and the upload page tells them apart so it can
 * say which mistake they made.
 */
export type InvalidTakeoutCsvReason = "empty" | "missing-columns";

export class InvalidTakeoutCsvError extends Error {
  readonly reason: InvalidTakeoutCsvReason;

  constructor(reason: InvalidTakeoutCsvReason, message: string) {
    super(message);
    this.name = "InvalidTakeoutCsvError";
    this.reason = reason;
  }
}

/**
 * The channels a file yielded. `skippedRows` counts the data rows that produced
 * no channel, whether because the row named no channel or because an earlier row
 * already named that one, so `channels.length + skippedRows` is every data row
 * the file held. The upload page reads the pair out loud ("140 channels found, 2
 * rows skipped") rather than dropping rows in silence.
 */
export interface TakeoutParseResult {
  channels: TakeoutChannel[];
  skippedRows: number;
}

/**
 * Whether a line held nothing to read: no comma and no content. A row of empty
 * fields (`,,`) is a row the file meant to hold, and stays in so it can be
 * counted as skipped.
 */
function isBlankLine(row: string[]): boolean {
  return row.length === 1 && row[0].trim() === "";
}

/**
 * Splits CSV text into rows of fields, honouring RFC 4180 quoting: a quoted
 * field may hold commas, and a doubled double quote inside one is a literal
 * quote. LF, CRLF and lone CR all end a row, and blank lines are dropped.
 */
function splitRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char !== '"') {
        field += char;
        continue;
      }
      if (text[i + 1] === '"') {
        field += '"';
        i += 1;
        continue;
      }
      quoted = false;
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  row.push(field);
  rows.push(row);
  return rows.filter((candidate) => !isBlankLine(candidate));
}

const CHANNEL_ID_COLUMN = "Channel Id";
const CHANNEL_URL_COLUMN = "Channel Url";
const CHANNEL_TITLE_COLUMN = "Channel Title";

/**
 * Finds a column by name, ignoring case and surrounding padding. The export
 * this was written against writes `Channel Id,Channel Url,Channel Title`, while
 * Google's own documentation writes `Channel ID` and `Channel URL`, and the
 * spelling moves with the locale and the export version. Casing is the only
 * thing that varies, so the words still have to match.
 */
function findColumn(header: string[], name: string): number {
  const wanted = name.trim().toLowerCase();
  return header.findIndex((candidate) => candidate.trim().toLowerCase() === wanted);
}

/**
 * Google's export is UTF-8 with a byte order mark, which would otherwise ride
 * along on the first header name and hide the column behind it.
 */
function stripByteOrderMark(text: string): string {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

/** Reads one field of a row, trimmed, absent columns included. */
function field(row: string[], index: number): string {
  return (row[index] ?? "").trim();
}

/** Trims a rejected header down to a readable length, since a wrong file's first line can run long. */
function quoteHeader(header: string[]): string {
  const joined = header.join(",");
  return joined.length > 80 ? `${joined.slice(0, 80)}...` : joined;
}

/**
 * Reads a YouTube subscriptions export (`subscriptions.csv` from Google Takeout)
 * into the channels it lists. Pure text in, channels out: this runs in the
 * browser on a file the person picked, so it touches nothing outside its input.
 *
 * Throws `InvalidTakeoutCsvError` when the text is not such an export at all.
 */
export function parseTakeoutSubscriptions(text: string): TakeoutParseResult {
  const rows = splitRows(stripByteOrderMark(text));
  const header = rows[0]?.map((name) => name.trim());
  if (header === undefined) {
    throw new InvalidTakeoutCsvError(
      "empty",
      "That file is empty. Upload the subscriptions.csv from your YouTube Takeout export.",
    );
  }

  const index = {
    channelId: findColumn(header, CHANNEL_ID_COLUMN),
    channelUrl: findColumn(header, CHANNEL_URL_COLUMN),
    channelTitle: findColumn(header, CHANNEL_TITLE_COLUMN),
  };
  if (index.channelId === -1 || index.channelUrl === -1 || index.channelTitle === -1) {
    throw new InvalidTakeoutCsvError(
      "missing-columns",
      `That file does not look like a YouTube subscriptions export. Its first row needs the columns ${CHANNEL_ID_COLUMN}, ${CHANNEL_URL_COLUMN} and ${CHANNEL_TITLE_COLUMN}, and instead reads: ${quoteHeader(header)}`,
    );
  }

  const channels: TakeoutChannel[] = [];
  const seen = new Set<string>();
  let skippedRows = 0;

  for (const row of rows.slice(1)) {
    const channelId = field(row, index.channelId);
    if (channelId === "" || seen.has(channelId)) {
      skippedRows += 1;
      continue;
    }
    seen.add(channelId);
    channels.push({
      channelId,
      channelUrl: field(row, index.channelUrl),
      channelTitle: field(row, index.channelTitle),
    });
  }

  return { channels, skippedRows };
}
