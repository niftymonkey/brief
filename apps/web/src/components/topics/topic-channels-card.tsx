"use client";

import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TakeoutImport } from "@/components/topics/takeout-import";
import { TopicSection } from "@/components/topics/topic-section";
import {
  addTopicChannelAction,
  importTopicChannelsAction,
  removeTopicChannelAction,
} from "@/app/(app)/topics/actions";
import { parseTopicChannelInput } from "@/lib/topic-channel-input";
import type { TakeoutChannelInput, TopicChannel } from "@/lib/topics";

interface TopicChannelsCardProps {
  topicId: string;
  channels: TopicChannel[];
  editable: boolean;
}

export function TopicChannelsCard({ topicId, channels, editable }: TopicChannelsCardProps) {
  const [channelField, setChannelField] = useState("");
  const [titleField, setTitleField] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isAdding) return;

    const parsed = parseTopicChannelInput(channelField, titleField);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setIsAdding(true);
    setError(null);
    try {
      const result = await addTopicChannelAction(topicId, parsed.value);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setChannelField("");
      setTitleField("");
    } catch {
      setError("Could not add that channel. Please try again.");
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemove = async (channelId: string) => {
    setRemovingId(channelId);
    setError(null);
    try {
      const result = await removeTopicChannelAction(topicId, channelId);
      if (!result.ok) {
        setError(result.error);
      }
    } catch {
      setError("Could not remove that channel. Please try again.");
    } finally {
      setRemovingId(null);
    }
  };

  const handleImport = (picked: TakeoutChannelInput[]) =>
    importTopicChannelsAction(topicId, picked);

  return (
    <TopicSection
      title="Trusted channels"
      description="Channels this topic always reads, whatever the searches turn up."
    >
      {channels.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No channels yet.
          {editable && " Add one by hand below, or import your subscriptions export."}
        </p>
      ) : (
        <ul className="rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
          {channels.map((channel) => (
            <li key={channel.id} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--color-text-primary)] truncate">
                  {channel.channelTitle || channel.youtubeChannelId}
                </p>
                <p className="font-mono text-xs text-[var(--color-text-tertiary)] truncate">
                  {channel.youtubeChannelId}
                </p>
              </div>
              {editable && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Remove ${channel.channelTitle || channel.youtubeChannelId}`}
                  onClick={() => handleRemove(channel.id)}
                  disabled={removingId === channel.id}
                >
                  {removingId === channel.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <X className="w-4 h-4" />
                  )}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-500">
          {error}
        </p>
      )}

      {editable && (
        <>
          <form onSubmit={handleAdd} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="topic-channel-id">Add a channel</Label>
              <Input
                id="topic-channel-id"
                value={channelField}
                onChange={(event) => {
                  setChannelField(event.target.value);
                  setError(null);
                }}
                placeholder="Channel ID or youtube.com/channel/... URL"
              />
            </div>
            <div className="w-full sm:w-48 space-y-1.5">
              <Label htmlFor="topic-channel-title">Name it (optional)</Label>
              <Input
                id="topic-channel-title"
                value={titleField}
                onChange={(event) => setTitleField(event.target.value)}
                placeholder="Fireship"
              />
            </div>
            <Button type="submit" disabled={!channelField.trim() || isAdding}>
              {isAdding ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Adding
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Add
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 pt-4 border-t border-[var(--color-border)]">
            <h4 className="mb-1 text-sm font-medium text-[var(--color-text-primary)]">
              Import from your subscriptions
            </h4>
            <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
              Export your YouTube subscriptions from Google Takeout, then tick the channels that
              belong to this topic. No Google account connection needed.
            </p>
            <TakeoutImport
              presentChannelIds={channels.map((channel) => channel.youtubeChannelId)}
              onImport={handleImport}
            />
          </div>
        </>
      )}
    </TopicSection>
  );
}
