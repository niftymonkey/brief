import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { CollectionDetail } from "@/components/collections/collection-detail";
import { getCollectionVideoFacts, getCollectionWithItems } from "@/lib/collections";
import { isEmailAllowed } from "@/lib/access";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { user } = await withAuth();
  if (!user) {
    return { title: "Collection | Brief" };
  }

  const { id } = await params;
  const collection = await getCollectionWithItems(user.id, id);

  return {
    title: collection ? `${collection.title} | Brief` : "Not Found | Brief",
  };
}

/**
 * The origin share links are built from, taken from the request so the link a
 * curator copies points back at the host they are actually on.
 */
async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  if (!host) return "";
  const protocol =
    headerList.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${protocol}://${host}`;
}

function curatorName(user: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string | null {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || user.email || null;
}

export default async function CollectionPage({ params }: PageProps) {
  const { user } = await withAuth();

  if (!user) {
    redirect("/");
  }

  const { id } = await params;
  const collection = await getCollectionWithItems(user.id, id);

  if (!collection) {
    notFound();
  }

  const editable = isEmailAllowed(user.email);
  const videoFacts = await getCollectionVideoFacts(
    user.id,
    collection.items.map((item) => item.videoId),
  );
  const siteOrigin = await requestOrigin();
  const updatedLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(collection.updatedAt));

  return (
    <main className="flex-1 px-4 py-4 pb-20">
      <article className="max-w-[50rem] mx-auto">
        <div className="mb-5">
          <Link
            href="/collections"
            className="inline-flex items-center gap-2 text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to collections
          </Link>
        </div>

        <CollectionDetail
          collection={collection}
          editable={editable}
          videoFacts={videoFacts}
          curator={curatorName(user)}
          updatedLabel={updatedLabel}
          siteOrigin={siteOrigin}
        />
      </article>
    </main>
  );
}
