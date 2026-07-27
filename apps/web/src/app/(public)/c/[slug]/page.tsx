import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SharedCollection } from "@/components/collections/shared-collection";
import { buildSitting, type EntryVideoFacts } from "@/lib/collection-entries";
import {
  getSharedCollectionBySlug,
  getSharedCollectionVideoFacts,
  type CollectionWithItems,
} from "@/lib/collections";
import { sharedCollectionDescription, unfurlThumbnailUrl } from "@/lib/shared-collection-meta";

interface PageProps {
  params: Promise<{ slug: string }>;
}

interface SharedCollectionView {
  collection: CollectionWithItems;
  videoFacts: Record<string, EntryVideoFacts>;
}

/**
 * Everything the page and its metadata read, loaded once per request. Returns
 * null for a slug that was never minted and for one whose collection has had
 * sharing revoked, which both reach the reader as the same 404.
 */
const loadSharedCollection = cache(
  async (slug: string): Promise<SharedCollectionView | null> => {
    const collection = await getSharedCollectionBySlug(slug);
    if (!collection) return null;

    const videoFacts = await getSharedCollectionVideoFacts(
      collection.id,
      collection.items.map((item) => item.videoId),
    );
    return { collection, videoFacts };
  },
);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const view = await loadSharedCollection(slug);

  if (!view) {
    return { title: "Not Found | Brief" };
  }

  const { collection, videoFacts } = view;
  const sitting = buildSitting(collection.items, videoFacts);
  const description = sharedCollectionDescription(collection.description, sitting);
  const image = unfurlThumbnailUrl(sitting.entries[0]?.videoId);

  return {
    title: `${collection.title} | Brief`,
    description,
    robots: {
      index: false,
      follow: false,
    },
    openGraph: {
      title: collection.title,
      description,
      type: "article",
      images: image
        ? [{ url: image, width: 480, height: 360, alt: collection.title }]
        : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: collection.title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function SharedCollectionPage({ params }: PageProps) {
  const { slug } = await params;
  const view = await loadSharedCollection(slug);

  if (!view) {
    notFound();
  }

  const { collection, videoFacts } = view;
  const updatedLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(collection.updatedAt));

  return (
    <main className="flex-1 px-4 py-4 pb-20">
      <article className="max-w-[50rem] mx-auto">
        <SharedCollection
          collection={collection}
          videoFacts={videoFacts}
          updatedLabel={updatedLabel}
        />

        <section className="mt-10 py-6 px-4 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-center">
          <p className="text-[var(--color-text-secondary)] mb-4">
            Build your own collections from AI summaries of any YouTube video.
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
