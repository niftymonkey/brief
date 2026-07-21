import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { CollectionCard } from "@/components/collections/collection-card";
import { NewCollectionDialog } from "@/components/collections/new-collection-dialog";
import { AccessRestricted } from "@/components/access-restricted";
import { listCollections } from "@/lib/collections";
import { isEmailAllowed } from "@/lib/access";

export const metadata: Metadata = {
  title: "Collections | Brief",
};

export default async function CollectionsPage() {
  const { user } = await withAuth();

  if (!user) {
    redirect("/");
  }

  const hasAccess = isEmailAllowed(user.email);
  const collections = await listCollections(user.id);

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
              Collections
            </h2>
            <p className="text-[var(--color-text-secondary)]">
              {collections.length} {collections.length === 1 ? "collection" : "collections"}
            </p>
          </div>
          {hasAccess && <NewCollectionDialog />}
        </div>

        {collections.length === 0 ? (
          hasAccess ? (
            <div className="text-center py-12">
              <p className="text-[var(--color-text-secondary)]">No collections yet</p>
              <div className="mt-4 inline-flex">
                <NewCollectionDialog variant="outline" />
              </div>
            </div>
          ) : (
            <AccessRestricted
              title="Curate your collections"
              description="Collections are currently limited to early access users."
              note="Access is opening up more broadly soon. Stay tuned!"
            />
          )
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {collections.map((collection) => (
              <CollectionCard key={collection.id} collection={collection} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
