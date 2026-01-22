import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ChapterGrid } from "@/components/chapter-grid";
import { Card, CardContent } from "@/components/ui/card";
import { getSharedDigestBySlug } from "@/lib/db";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const digest = await getSharedDigestBySlug(slug);

  if (!digest) {
    return {
      title: "Not Found | YouTube Digest",
    };
  }

  const thumbnailUrl = digest.thumbnailUrl || `https://i.ytimg.com/vi/${digest.videoId}/hqdefault.jpg`;
  const description = digest.summary.length > 160
    ? digest.summary.slice(0, 157) + "..."
    : digest.summary;

  return {
    title: `${digest.title} | YouTube Digest`,
    description,
    robots: {
      index: false,
      follow: false,
    },
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

export default async function SharedDigestPage({ params }: PageProps) {
  const { slug } = await params;
  const digest = await getSharedDigestBySlug(slug);

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
        {/* Embedded YouTube Player */}
        <div className="relative aspect-video rounded-2xl overflow-hidden mb-4 bg-black">
          <iframe
            src={`https://www.youtube.com/embed/${digest.videoId}`}
            title={digest.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="absolute inset-0 w-full h-full"
          />
        </div>

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

        {/* Chapters */}
        <section className="mt-6 mb-4">
          <ChapterGrid
            sections={digest.sections}
            videoId={digest.videoId}
            hasCreatorChapters={digest.hasCreatorChapters}
          />
        </section>

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

        {/* CTA */}
        <section className="mt-6 py-6 px-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-center">
          <p className="text-[var(--color-text-secondary)] mb-4">
            Create your own digests with AI summaries, timestamps, and more.
          </p>
          <Link
            href="/auth"
            prefetch={false}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-base font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors cursor-pointer"
          >
            Get Started
            <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </article>
    </main>
  );
}
