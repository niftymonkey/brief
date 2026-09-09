import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { DeleteTopicButton } from "@/components/topics/delete-topic-button";
import { TopicChannelsCard } from "@/components/topics/topic-channels-card";
import { TopicIdentityCard } from "@/components/topics/topic-identity-card";
import { TopicQueriesCard } from "@/components/topics/topic-queries-card";
import { TopicSettingsCard } from "@/components/topics/topic-settings-card";
import { getTopicWithFeedsBySlug } from "@/lib/topics";
import { isEmailAllowed } from "@/lib/access";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { user } = await withAuth();
  if (!user) {
    return { title: "Topic | Brief" };
  }

  const { slug } = await params;
  const topic = await getTopicWithFeedsBySlug(user.id, slug);

  return {
    title: topic ? `${topic.name} | Brief` : "Not Found | Brief",
  };
}

export default async function TopicPage({ params }: PageProps) {
  const { user } = await withAuth();

  if (!user) {
    redirect("/");
  }

  const { slug } = await params;
  const topic = await getTopicWithFeedsBySlug(user.id, slug);

  if (!topic) {
    notFound();
  }

  const editable = isEmailAllowed(user.email);

  return (
    <main className="flex-1 px-4 py-4 pb-20">
      <div className="max-w-[50rem] mx-auto">
        <div className="mb-5">
          <Link
            href="/topics"
            className="inline-flex items-center gap-2 text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to topics
          </Link>
        </div>

        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-heading font-semibold text-[var(--color-text-primary)]">
              {topic.name}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              {topic.isActive ? "Surveyed" : "Paused, would be surveyed"} every{" "}
              {topic.cadenceDays} {topic.cadenceDays === 1 ? "day" : "days"}, looking back{" "}
              {topic.windowDays} {topic.windowDays === 1 ? "day" : "days"}
            </p>
          </div>
          {editable && <DeleteTopicButton topicId={topic.id} name={topic.name} />}
        </div>

        <div className="space-y-4">
          <TopicIdentityCard
            topicId={topic.id}
            name={topic.name}
            slug={topic.slug}
            interests={topic.interests}
            isActive={topic.isActive}
            editable={editable}
          />

          <TopicSettingsCard
            topicId={topic.id}
            settings={{
              cadenceDays: topic.cadenceDays,
              windowDays: topic.windowDays,
              maxStandingQueries: topic.maxStandingQueries,
              maxProbesPerRun: topic.maxProbesPerRun,
              maxGroupsPerRun: topic.maxGroupsPerRun,
              maxVideosPerGroup: topic.maxVideosPerGroup,
              maxChannelVideosPerRun: topic.maxChannelVideosPerRun,
            }}
            editable={editable}
          />

          <TopicChannelsCard
            topicId={topic.id}
            channels={topic.channels}
            editable={editable}
          />

          <TopicQueriesCard
            topicId={topic.id}
            queries={topic.queries}
            maxStandingQueries={topic.maxStandingQueries}
            editable={editable}
          />
        </div>
      </div>
    </main>
  );
}
