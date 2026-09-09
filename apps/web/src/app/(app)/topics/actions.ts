"use server";

import { revalidatePath } from "next/cache";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { isEmailAllowed } from "@/lib/access";
import type { TopicActionResult, TopicCreateResult } from "@/lib/topic-action-result";
import type { TopicSettings } from "@/lib/topic-settings-input";
import { parseTopicQuery } from "@/lib/topic-query-input";
import {
  DuplicateTopicQueryError,
  InvalidTopicCapError,
  InvalidTopicScheduleError,
  TopicQueryLimitError,
  addTopicChannel,
  addTopicChannelsFromTakeout,
  addTopicQuery,
  createTopic,
  deleteTopic,
  removeTopicChannel,
  removeTopicQuery,
  updateTopic,
  updateTopicQuery,
  type AddTopicChannelInput,
  type TakeoutChannelInput,
} from "@/lib/topics";

const NO_TOPIC = "That topic is not there any more. Reload the page.";

type Editor = { ok: true; userId: string } | { ok: false; error: string };

/**
 * The signed-in user, when they are allowed to change Topics at all. Every action
 * starts here rather than trusting the page that rendered the form, because a
 * Server Action is its own entry point.
 */
async function currentEditor(): Promise<Editor> {
  const { user } = await withAuth();
  if (!user) {
    return { ok: false, error: "Sign in to change this topic." };
  }
  if (!isEmailAllowed(user.email)) {
    return { ok: false, error: "Topics are currently limited to early access users." };
  }
  return { ok: true, userId: user.id };
}

/**
 * Freshens the list and every Topic page. The detail route is revalidated by its
 * pattern rather than by a slug the caller passed, so the actions never act on a
 * path the browser chose. The pattern carries the `(app)` route group because
 * revalidatePath matches the route file structure, where this page is
 * `/(app)/topics/[slug]/page`, not the URL a person sees.
 */
function revalidateTopics(): void {
  revalidatePath("/topics");
  revalidatePath("/(app)/topics/[slug]", "page");
}

/**
 * Turns a data-layer refusal into the sentence a person reads. The layer's own
 * messages name their fields the way the code does, and a Postgres constraint name
 * is never the thing to show, so each named error gets prose here.
 */
function refusal(cause: unknown): string | null {
  if (cause instanceof InvalidTopicScheduleError) {
    return "The window has to be at least as long as the cadence, or the days in between go unread.";
  }
  if (cause instanceof InvalidTopicCapError) {
    return "One of the per-survey limits is below the smallest value it allows.";
  }
  if (cause instanceof DuplicateTopicQueryError) {
    return "This topic already holds that search.";
  }
  if (cause instanceof TopicQueryLimitError) {
    return "This topic is already at its standing search limit. Raise the limit or remove a search to make room.";
  }
  return null;
}

export async function createTopicAction(input: {
  name: string;
  interests: string;
}): Promise<TopicCreateResult> {
  const editor = await currentEditor();
  if (!editor.ok) return editor;

  const name = input.name.trim();
  if (name === "") {
    return { ok: false, error: "A topic needs a name." };
  }
  const interests = input.interests.trim();

  try {
    const topic = await createTopic(editor.userId, {
      name,
      interests: interests === "" ? null : interests,
    });
    revalidateTopics();
    return { ok: true, slug: topic.slug };
  } catch (cause) {
    return { ok: false, error: refusal(cause) ?? "Could not create the topic. Please try again." };
  }
}

export async function updateTopicIdentityAction(
  topicId: string,
  input: { name: string; interests: string },
): Promise<TopicActionResult> {
  const editor = await currentEditor();
  if (!editor.ok) return editor;

  const name = input.name.trim();
  if (name === "") {
    return { ok: false, error: "A topic needs a name." };
  }
  const interests = input.interests.trim();

  try {
    const topic = await updateTopic(editor.userId, topicId, {
      name,
      interests: interests === "" ? null : interests,
    });
    if (!topic) return { ok: false, error: NO_TOPIC };
    revalidateTopics();
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: refusal(cause) ?? "Could not save those changes. Please try again." };
  }
}

export async function updateTopicSettingsAction(
  topicId: string,
  settings: TopicSettings,
): Promise<TopicActionResult> {
  const editor = await currentEditor();
  if (!editor.ok) return editor;

  try {
    const topic = await updateTopic(editor.userId, topicId, settings);
    if (!topic) return { ok: false, error: NO_TOPIC };
    revalidateTopics();
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: refusal(cause) ?? "Could not save those settings. Please try again." };
  }
}

export async function setTopicActiveAction(
  topicId: string,
  isActive: boolean,
): Promise<TopicActionResult> {
  const editor = await currentEditor();
  if (!editor.ok) return editor;

  try {
    const topic = await updateTopic(editor.userId, topicId, { isActive });
    if (!topic) return { ok: false, error: NO_TOPIC };
    revalidateTopics();
    return { ok: true };
  } catch (cause) {
    return {
      ok: false,
      error: refusal(cause) ?? "Could not change whether this topic is active.",
    };
  }
}

export async function deleteTopicAction(topicId: string): Promise<TopicActionResult> {
  const editor = await currentEditor();
  if (!editor.ok) return editor;

  const deleted = await deleteTopic(editor.userId, topicId);
  if (!deleted) return { ok: false, error: NO_TOPIC };
  revalidateTopics();
  return { ok: true };
}

export async function addTopicChannelAction(
  topicId: string,
  input: AddTopicChannelInput,
): Promise<TopicActionResult> {
  const editor = await currentEditor();
  if (!editor.ok) return editor;

  const channel = await addTopicChannel(editor.userId, topicId, {
    youtubeChannelId: input.youtubeChannelId,
    channelTitle: input.channelTitle,
    channelUrl: input.channelUrl,
    addedVia: "manual",
  });
  if (!channel) return { ok: false, error: NO_TOPIC };
  revalidateTopics();
  return { ok: true };
}

export async function importTopicChannelsAction(
  topicId: string,
  channels: TakeoutChannelInput[],
): Promise<TopicActionResult> {
  const editor = await currentEditor();
  if (!editor.ok) return editor;

  if (channels.length === 0) {
    return { ok: false, error: "Tick at least one channel to add." };
  }

  const added = await addTopicChannelsFromTakeout(editor.userId, topicId, channels);
  if (added === null) return { ok: false, error: NO_TOPIC };
  revalidateTopics();
  return { ok: true };
}

export async function removeTopicChannelAction(
  topicId: string,
  channelId: string,
): Promise<TopicActionResult> {
  const editor = await currentEditor();
  if (!editor.ok) return editor;

  const removed = await removeTopicChannel(editor.userId, topicId, channelId);
  if (!removed) {
    return { ok: false, error: "That channel is already off this topic." };
  }
  revalidateTopics();
  return { ok: true };
}

export async function addTopicQueryAction(
  topicId: string,
  query: string,
): Promise<TopicActionResult> {
  const editor = await currentEditor();
  if (!editor.ok) return editor;

  const parsed = parseTopicQuery(query);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  try {
    const added = await addTopicQuery(editor.userId, topicId, parsed.value);
    if (!added) return { ok: false, error: NO_TOPIC };
    revalidateTopics();
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: refusal(cause) ?? "Could not add that search. Please try again." };
  }
}

export async function updateTopicQueryAction(
  topicId: string,
  queryId: string,
  query: string,
): Promise<TopicActionResult> {
  const editor = await currentEditor();
  if (!editor.ok) return editor;

  const parsed = parseTopicQuery(query);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  try {
    const edited = await updateTopicQuery(editor.userId, topicId, queryId, parsed.value);
    if (!edited) return { ok: false, error: "That search is no longer on this topic." };
    revalidateTopics();
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: refusal(cause) ?? "Could not save that search. Please try again." };
  }
}

export async function removeTopicQueryAction(
  topicId: string,
  queryId: string,
): Promise<TopicActionResult> {
  const editor = await currentEditor();
  if (!editor.ok) return editor;

  const removed = await removeTopicQuery(editor.userId, topicId, queryId);
  if (!removed) {
    return { ok: false, error: "That search is already off this topic." };
  }
  revalidateTopics();
  return { ok: true };
}
