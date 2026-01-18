import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink, ArrowLeft } from "lucide-react";
import { Header } from "@/components/header";
import { SectionAccordion } from "@/components/section-accordion";
import { Timestamp } from "@/components/timestamp";
import { getDigestById } from "@/lib/db";

interface PageProps {
  params: Promise<{ id: string }>;
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
  const { id } = await params;
  const digest = await getDigestById(id);

  if (!digest) {
    notFound();
  }

  const thumbnailUrl = digest.thumbnailUrl || `https://i.ytimg.com/vi/${digest.videoId}/hqdefault.jpg`;
  const publishDate = digest.publishedAt
    ? new Date(digest.publishedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 px-4 py-8">
        <article className="max-w-3xl mx-auto">
          {/* Back button */}
          <div className="mb-6">
            <Link
              href="/digests"
              className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              All digests
            </Link>
          </div>

          {/* Thumbnail */}
          <a
            href={`https://youtube.com/watch?v=${digest.videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block relative aspect-video rounded-2xl overflow-hidden mb-6 group"
          >
            <Image
              src={thumbnailUrl}
              alt={digest.title}
              fill
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <ExternalLink className="w-6 h-6 text-white" />
              </div>
            </div>
          </a>

          {/* Title */}
          <h1 className="text-3xl md:text-4xl font-semibold text-[var(--color-text-primary)] mb-3">
            {digest.title}
          </h1>

          {/* Meta line */}
          <div className="flex flex-wrap items-center gap-2 text-[var(--color-text-secondary)] mb-8">
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

          {/* At a Glance */}
          <section className="mb-10">
            <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-3 pb-2 border-b border-[var(--color-border)]">
              At a Glance
            </h2>
            <p className="text-[var(--color-text-primary)] leading-relaxed">
              {digest.summary}
            </p>
          </section>

          {/* Sections */}
          <section className="mb-10">
            <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-4 pb-2 border-b border-[var(--color-border)]">
              Sections
            </h2>
            <SectionAccordion
              sections={digest.sections}
              videoId={digest.videoId}
            />
          </section>

          {/* Links & Resources */}
          {(digest.relatedLinks.length > 0 || digest.otherLinks.length > 0) && (
            <section className="mb-10">
              <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-4 pb-2 border-b border-[var(--color-border)]">
                Links & Resources
              </h2>

              {digest.relatedLinks.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-medium text-[var(--color-text-primary)] mb-3">
                    From the video
                  </h3>
                  <ul className="space-y-3">
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
                            {" "}
                            - {link.description}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {digest.otherLinks.length > 0 && (
                <div>
                  <h3 className="font-medium text-[var(--color-text-primary)] mb-3">
                    Other links
                  </h3>
                  <ul className="space-y-3">
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
                            {" "}
                            - {link.description}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* Tangents */}
          {digest.tangents && digest.tangents.length > 0 && (
            <section className="mb-10">
              <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-4 pb-2 border-b border-[var(--color-border)]">
                Tangents
              </h2>
              <ul className="space-y-4">
                {digest.tangents.map((tangent, index) => (
                  <li
                    key={index}
                    className="p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]"
                  >
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <span className="font-medium text-[var(--color-text-primary)]">
                        {tangent.title}
                      </span>
                      <div className="flex items-center gap-2 text-sm shrink-0">
                        <Timestamp
                          time={tangent.timestampStart}
                          videoId={digest.videoId}
                        />
                        <span className="text-[var(--color-text-tertiary)]">-</span>
                        <Timestamp
                          time={tangent.timestampEnd}
                          videoId={digest.videoId}
                        />
                      </div>
                    </div>
                    <p className="text-[var(--color-text-secondary)]">
                      {tangent.summary}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      </main>
    </div>
  );
}
