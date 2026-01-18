"use client";

import Image from "next/image";
import { ExternalLink } from "lucide-react";
import { SectionAccordion } from "./section-accordion";
import { Timestamp } from "./timestamp";
import type { VideoMetadata, StructuredDigest } from "@/lib/types";

interface DigestResultProps {
  metadata: VideoMetadata;
  digest: StructuredDigest;
  onReset: () => void;
}

/**
 * Formats ISO 8601 duration (PT1H23M45S) to human-readable format
 */
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

export function DigestResult({ metadata, digest, onReset }: DigestResultProps) {
  const thumbnailUrl = `https://i.ytimg.com/vi/${metadata.videoId}/hqdefault.jpg`;

  const publishDate = metadata.publishedAt
    ? new Date(metadata.publishedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <article className="max-w-3xl mx-auto">
      {/* New Digest button */}
      <div className="mb-4 md:mb-6">
        <button
          onClick={onReset}
          className="text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors text-sm"
        >
          ← New digest
        </button>
      </div>

      {/* Thumbnail */}
      <a
        href={`https://youtube.com/watch?v=${metadata.videoId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block relative aspect-video rounded-2xl overflow-hidden mb-4 md:mb-6 group"
      >
        <Image
          src={thumbnailUrl}
          alt={metadata.title}
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
      <h1 className="font-serif text-3xl md:text-4xl text-[var(--color-text-primary)] mb-3">
        {metadata.title}
      </h1>

      {/* Meta line */}
      <div className="flex flex-wrap items-center gap-2 text-[var(--color-text-secondary)] mb-6 md:mb-8">
        <span>{metadata.channelTitle}</span>
        {metadata.duration && (
          <>
            <span className="text-[var(--color-text-tertiary)]">•</span>
            <span>{formatDuration(metadata.duration)}</span>
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
      <section className="mb-6 md:mb-10">
        <h2 className="font-serif text-xl text-[var(--color-text-primary)] mb-3 pb-2 border-b border-[var(--color-border)]">
          At a Glance
        </h2>
        <p className="text-[var(--color-text-primary)] leading-relaxed">
          {digest.summary}
        </p>
      </section>

      {/* Sections */}
      <section className="mb-6 md:mb-10">
        <h2 className="font-serif text-xl text-[var(--color-text-primary)] mb-4 pb-2 border-b border-[var(--color-border)]">
          Sections
        </h2>
        <SectionAccordion
          sections={digest.sections}
          videoId={metadata.videoId}
        />
      </section>

      {/* Links & Resources */}
      {(digest.relatedLinks.length > 0 || digest.otherLinks.length > 0) && (
        <section className="mb-6 md:mb-10">
          <h2 className="font-serif text-xl text-[var(--color-text-primary)] mb-4 pb-2 border-b border-[var(--color-border)]">
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
        <section className="mb-6 md:mb-10">
          <h2 className="font-serif text-xl text-[var(--color-text-primary)] mb-4 pb-2 border-b border-[var(--color-border)]">
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
                      videoId={metadata.videoId}
                    />
                    <span className="text-[var(--color-text-tertiary)]">-</span>
                    <Timestamp
                      time={tangent.timestampEnd}
                      videoId={metadata.videoId}
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
  );
}
