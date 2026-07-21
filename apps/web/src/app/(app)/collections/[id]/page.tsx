import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { CollectionDetail } from "@/components/collections/collection-detail";
import { getCollectionWithItems } from "@/lib/collections";
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

  return (
    <main className="flex-1 px-4 py-4">
      <article className="max-w-3xl mx-auto">
        <div className="mb-4">
          <Link
            href="/collections"
            className="inline-flex items-center gap-2 text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to collections
          </Link>
        </div>

        <CollectionDetail collection={collection} editable={editable} />
      </article>
    </main>
  );
}
