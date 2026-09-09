"use client";

import { useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InvalidTakeoutCsvError,
  parseTakeoutSubscriptions,
  type TakeoutChannel,
} from "@/lib/takeout-csv";
import type { TopicActionResult } from "@/lib/topic-action-result";
import type { TakeoutChannelInput } from "@/lib/topics";

/**
 * The part of a picked file this component reads. A browser `File` satisfies it,
 * and naming it keeps the reader honest about how little of the file is touched:
 * its text, in this tab, and nothing else.
 */
interface PickedFile {
  name: string;
  text(): Promise<string>;
}

interface TakeoutImportProps {
  /** Channel ids the Topic already holds, so a row can say so instead of looking new. */
  presentChannelIds: string[];
  onImport: (channels: TakeoutChannelInput[]) => Promise<TopicActionResult>;
}

const WRONG_FILE_HINT =
  "Look for subscriptions.csv inside the YouTube folder of your Google Takeout export.";

/**
 * Orders an export the way a person reads it: by title, case-insensitively and
 * locale-aware, with the titles left exactly as the file wrote them. A row whose
 * title is blank carries nothing to read, so it goes last and is ordered by the
 * channel id that is all it has. Channels the Topic already holds stay in the run
 * rather than being grouped away, because a person looking for one still looks
 * where its name falls.
 */
export function sortTakeoutChannels(channels: TakeoutChannel[]): TakeoutChannel[] {
  return [...channels].sort((left, right) => {
    if (left.channelTitle === "" || right.channelTitle === "") {
      if (left.channelTitle !== "") return -1;
      if (right.channelTitle !== "") return 1;
      return left.channelId.localeCompare(right.channelId);
    }
    return left.channelTitle.localeCompare(right.channelTitle, undefined, {
      sensitivity: "base",
    });
  });
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function toChannelInput(channel: TakeoutChannel): TakeoutChannelInput {
  return {
    youtubeChannelId: channel.channelId,
    channelTitle: channel.channelTitle === "" ? null : channel.channelTitle,
    channelUrl: channel.channelUrl === "" ? null : channel.channelUrl,
  };
}

/**
 * Picks a YouTube subscriptions export apart in the browser and imports the rows a
 * person ticks. The file is read with `file.text()` and parsed here, so what leaves
 * the tab is the ticked channels and nothing else.
 */
export function TakeoutImport({ presentChannelIds, onImport }: TakeoutImportProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [channels, setChannels] = useState<TakeoutChannel[] | null>(null);
  const [skippedRows, setSkippedRows] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState<number | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const present = new Set(presentChannelIds);
  const needle = filter.trim().toLowerCase();
  const shown = (channels ?? []).filter(
    (channel) => needle === "" || channel.channelTitle.toLowerCase().includes(needle),
  );
  // Select all and select none speak about the rows on screen, which is what a
  // person filtered down to "Matt" means by them.
  const selectableShown = shown.filter((channel) => !present.has(channel.channelId));
  const presentInFile = (channels ?? []).filter((channel) =>
    present.has(channel.channelId),
  ).length;

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const picked: PickedFile | undefined = input.files?.[0];
    if (!picked) return;

    // A file input only fires `change` when the selection changes, so a message
    // asking for the file again would go unheard while the input still holds it.
    // Clearing it makes the same path, or a re-export under the same name, a
    // fresh pick.
    input.value = "";

    setFileName(picked.name);
    setAddedCount(null);
    setSelected(new Set());

    let text: string;
    try {
      text = await picked.text();
    } catch {
      setChannels(null);
      setError(`Could not read ${picked.name}. Pick the file again.`);
      return;
    }

    try {
      const parsed = parseTakeoutSubscriptions(text);
      setChannels(sortTakeoutChannels(parsed.channels));
      setFilter("");
      setSkippedRows(parsed.skippedRows);
      setError(null);
    } catch (cause) {
      setChannels(null);
      if (cause instanceof InvalidTakeoutCsvError) {
        setError(
          cause.reason === "missing-columns" ? `${cause.message} ${WRONG_FILE_HINT}` : cause.message,
        );
        return;
      }
      setError(`Could not read ${picked.name} as a CSV file. ${WRONG_FILE_HINT}`);
    }
  };

  const toggle = (channelId: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(channelId)) {
        next.delete(channelId);
      } else {
        next.add(channelId);
      }
      return next;
    });
  };

  const handleImport = async () => {
    if (selected.size === 0 || isImporting) return;

    const picked = (channels ?? []).filter(
      (channel) => selected.has(channel.channelId) && !present.has(channel.channelId),
    );
    setIsImporting(true);
    setError(null);
    try {
      const result = await onImport(picked.map(toChannelInput));
      if (result.ok) {
        setSelected(new Set());
        setAddedCount(picked.length);
      } else {
        setAddedCount(null);
        setError(result.error);
      }
    } catch {
      setAddedCount(null);
      setError("Could not add those channels. Please try again.");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="takeout-file">Subscriptions export</Label>
        <input
          id="takeout-file"
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="block w-full text-sm text-[var(--color-text-secondary)] file:mr-3 file:rounded-md file:border file:border-[var(--color-border)] file:bg-[var(--color-bg-tertiary)] file:px-3 file:py-1.5 file:text-sm file:text-[var(--color-text-primary)]"
        />
        <p className="text-xs text-[var(--color-text-tertiary)]">
          Reading happens in this tab. {WRONG_FILE_HINT}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}

      {addedCount !== null && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          Added {countLabel(addedCount, "channel", "channels")} to this topic.
        </p>
      )}

      {channels !== null && channels.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          That file listed no channels. {WRONG_FILE_HINT}
        </p>
      )}

      {channels !== null && channels.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[var(--color-text-secondary)]">
              {needle === ""
                ? countLabel(channels.length, "channel found", "channels found")
                : `${shown.length} of ${channels.length} channels shown`}
              {skippedRows > 0 && `, ${countLabel(skippedRows, "row skipped", "rows skipped")}`}
              {fileName && <span className="text-[var(--color-text-tertiary)]"> in {fileName}</span>}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSelected((previous) => {
                    const next = new Set(previous);
                    for (const channel of selectableShown) next.add(channel.channelId);
                    return next;
                  })
                }
                disabled={selectableShown.length === 0 || isImporting}
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSelected((previous) => {
                    const next = new Set(previous);
                    for (const channel of shown) next.delete(channel.channelId);
                    return next;
                  })
                }
                disabled={selected.size === 0 || isImporting}
              >
                Select none
              </Button>
            </div>
          </div>

          {presentInFile > 0 && (
            <p className="text-xs text-[var(--color-text-tertiary)]">
              {countLabel(presentInFile, "channel", "channels")} in this export{" "}
              {presentInFile === 1 ? "is" : "are"} already on this topic.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="takeout-filter">Filter by name</Label>
            <Input
              id="takeout-filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Type part of a channel name"
              disabled={isImporting}
            />
          </div>

          {shown.length === 0 && (
            <p className="text-sm text-[var(--color-text-secondary)]">
              No channel in this export matches that filter.
            </p>
          )}

          <ul className="max-h-72 overflow-y-auto rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
            {shown.map((channel) => {
              const alreadyPresent = present.has(channel.channelId);
              const label = channel.channelTitle || channel.channelId;
              return (
                <li key={channel.channelId} className="flex items-center gap-3 px-3 py-2">
                  <input
                    id={`takeout-${channel.channelId}`}
                    type="checkbox"
                    checked={selected.has(channel.channelId)}
                    disabled={alreadyPresent || isImporting}
                    onChange={() => toggle(channel.channelId)}
                    className="size-4 shrink-0 accent-[var(--color-accent)]"
                  />
                  <label
                    htmlFor={`takeout-${channel.channelId}`}
                    className="flex-1 min-w-0 text-sm text-[var(--color-text-primary)] truncate"
                  >
                    {label}
                  </label>
                  {alreadyPresent && (
                    <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">
                      Already added
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          <Button type="button" onClick={handleImport} disabled={selected.size === 0 || isImporting}>
            {isImporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Adding
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Add {countLabel(selected.size, "channel", "channels")}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
