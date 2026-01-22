import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { DigestViewer } from "@/components/digest-viewer";
import { DeleteDigestButton } from "@/components/delete-digest-button";
import { RegenerateDigestButton } from "@/components/regenerate-digest-button";
import { ShareButton } from "@/components/share-button";
import { Card, CardContent } from "@/components/ui/card";
import { getDigestById } from "@/lib/db";
import { isEmailAllowed } from "@/lib/access";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const digest = await getDigestById(id);

  if (!digest) {
    return {
      title: "Digest Not Found | YouTube Digest",
    };
  }

  const thumbnailUrl = digest.thumbnailUrl || `https://i.ytimg.com/vi/${digest.videoId}/hqdefault.jpg`;
  const description = digest.summary.length > 160
    ? digest.summary.slice(0, 157) + "..."
    : digest.summary;

  return {
    title: `${digest.title} | YouTube Digest`,
    description,
    openGraph: {
      title: digest.title,
      description,
      type: "article",
      images: [
        {
          url: thumbnailUrl,
          width: 480,
          height: 360,
          alt: digest.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: digest.title,
      description,
      images: [thumbnailUrl],
    },
  };
}

function formatDuration(isoDuration: string | null): string {
  if (!isoDuration) return "";
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return isoDuration;

  const hours = match[1] ? parseInt(match[1]) : 0;
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const seconds = match[3] ? parseInt(match[3]) : 0;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default async function DigestPage({ params }: PageProps) {
  const { user } = await withAuth();

  if (!user) {
    redirect("/");
  }

  const { id } = await params;
  const digest = await getDigestById(id, user.id);
  const canRegenerate = isEmailAllowed(user.email);

  if (!digest) {
    notFound();
  }

  const publishDate = digest.publishedAt
    ? new Date(digest.publishedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <main className="flex-1 px-4 py-4">
        <article className="max-w-3xl mx-auto">
          {/* Back button and actions */}
          <div className="mb-4 flex items-center justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-lg text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
            >
              <ArrowLeft className="w-6 h-6" />
              Back to library
            </Link>
            <div className="flex items-center gap-2">
              <ShareButton digestId={id} isShared={digest.isShared} slug={digest.slug} title={digest.title} />
              {canRegenerate && <RegenerateDigestButton digestId={id} videoId={digest.videoId} />}
              <DeleteDigestButton digestId={id} />
            </div>
          </div>

          {/* Embedded YouTube Player and Chapters */}
          <DigestViewer
            videoId={digest.videoId}
            title={digest.title}
            sections={digest.sections}
            hasCreatorChapters={digest.hasCreatorChapters}
          >
            {/* Title */}
            <h1 className="text-xl md:text-2xl font-semibold text-[var(--color-text-primary)] mb-2">
              {digest.title}
            </h1>

            {/* Meta line */}
            <div className="flex flex-wrap items-center gap-2 text-[var(--color-text-secondary)] mb-4">
              <span>{digest.channelName}</span>
              {digest.duration && (
                <>
                  <span className="text-[var(--color-text-tertiary)]">•</span>
                  <span>{formatDuration(digest.duration)}</span>
                </>
              )}
              {publishDate && (
                <>
                  <span className="text-[var(--color-text-tertiary)]">•</span>
                  <span>{publishDate}</span>
                </>
              )}
            </div>

            {/* The Gist */}
            <section className="mt-6 mb-4">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1.5 pb-1 border-b border-[var(--color-border)]">
                The Gist
              </h2>
              <p className="text-lg text-[var(--color-text-primary)] leading-relaxed pt-2">
                {digest.summary}
              </p>
            </section>
          </DigestViewer>

          {/* Links & Resources */}
          {(digest.relatedLinks.length > 0 || digest.otherLinks.length > 0) && (
            <section className="mt-6 mb-4">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1.5 pb-1 border-b border-[var(--color-border)]">
                Links & Resources
              </h2>

              <Card className="border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-0">
                <CardContent className="px-5 py-4 space-y-3">
                  {digest.relatedLinks.length > 0 && (
                    <div>
                      <h3 className="font-medium text-[var(--color-text-primary)] mb-1.5">
                        From the video
                      </h3>
                      <ul className="space-y-1">
                        {digest.relatedLinks.map((link, index) => (
                          <li key={index}>
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group"
                            >
                              <span className="font-medium text-[var(--color-accent)] group-hover:text-[var(--color-accent-hover)] transition-colors">
                                {link.title}
                              </span>
                              <span className="text-[var(--color-text-secondary)]">
                                {" "}- {link.description}
                              </span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {digest.otherLinks.length > 0 && (
                    <div>
                      <h3 className="font-medium text-[var(--color-text-primary)] mb-1.5">
                        Other links
                      </h3>
                      <ul className="space-y-1">
                        {digest.otherLinks.map((link, index) => (
                          <li key={index}>
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group"
                            >
                              <span className="font-medium text-[var(--color-accent)] group-hover:text-[var(--color-accent-hover)] transition-colors">
                                {link.title}
                              </span>
                              <span className="text-[var(--color-text-secondary)]">
                                {" "}- {link.description}
                              </span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          )}

      </article>
    </main>
  );
}
