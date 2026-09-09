import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { NewTopicDialog } from "@/components/topics/new-topic-dialog";
import { TopicCard } from "@/components/topics/topic-card";
import { AccessRestricted } from "@/components/access-restricted";
import { listTopics } from "@/lib/topics";
import { isEmailAllowed } from "@/lib/access";

export const metadata: Metadata = {
  title: "Topics | Brief",
};

export default async function TopicsPage() {
  const { user } = await withAuth();

  if (!user) {
    redirect("/");
  }

  const hasAccess = isEmailAllowed(user.email);
  const topics = await listTopics(user.id);

  return (
    <main className="flex-1 px-4 py-4 md:py-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to library
          </Link>
        </div>

        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-lg font-heading font-semibold text-[var(--color-text-primary)]">
              Topics
            </h2>
            <p className="text-[var(--color-text-secondary)]">
              {topics.length} {topics.length === 1 ? "topic" : "topics"}
            </p>
          </div>
          {hasAccess && <NewTopicDialog />}
        </div>

        {topics.length === 0 ? (
          hasAccess ? (
            <div className="text-center py-12">
              <p className="text-[var(--color-text-secondary)]">No topics yet</p>
              <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
                A topic is a subject you follow, with the channels and searches that feed it.
              </p>
              <div className="mt-4 inline-flex">
                <NewTopicDialog variant="outline" />
              </div>
            </div>
          ) : (
            <AccessRestricted
              title="Follow a subject, not a video"
              description="Topics are currently limited to early access users."
              note="Access is opening up more broadly soon. Stay tuned!"
            />
          )
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {topics.map((topic) => (
              <TopicCard key={topic.id} topic={topic} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
