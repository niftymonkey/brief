import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { DigestCard } from "@/components/digest-card";
import { DigestSearch } from "@/components/digest-search";
import { getDigests } from "@/lib/db";
import { cn } from "@/lib/utils";

interface PageProps {
  searchParams: Promise<{ search?: string }>;
}

async function DigestGrid({ userId, search }: { userId: string; search?: string }) {
  const { digests } = await getDigests({ userId, search, limit: 50 });

  if (digests.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--color-text-secondary)]">
          {search ? "No digests match your search" : "No digests yet"}
        </p>
        {!search && (
          <Link
            href="/home"
            className="mt-4 inline-block text-[var(--color-accent)] hover:underline"
          >
            Create your first digest
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {digests.map((digest) => (
        <DigestCard key={digest.id} digest={digest} />
      ))}
    </div>
  );
}

function DigestGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] animate-pulse"
        >
          <div className="aspect-video rounded-lg bg-[var(--color-bg-tertiary)] mb-3" />
          <div className="h-5 bg-[var(--color-bg-tertiary)] rounded w-3/4 mb-2" />
          <div className="h-4 bg-[var(--color-bg-tertiary)] rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}

export default async function DigestsPage({ searchParams }: PageProps) {
  const { user } = await withAuth();

  if (!user) {
    redirect("/");
  }

  const { search } = await searchParams;
  const { total } = await getDigests({ userId: user.id, limit: 1 });

  return (
    <main className="flex-1 px-4 py-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
              Your Digests
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              {total} {total === 1 ? "digest" : "digests"} saved
            </p>
          </div>
          <Link
            href="/home"
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-lg",
              "bg-[var(--color-accent)] text-white",
              "hover:bg-[var(--color-accent-hover)] transition-colors"
            )}
          >
            <Plus className="w-4 h-4" />
            New
          </Link>
        </div>

        {/* Search */}
        <DigestSearch />

        {/* Content */}
        <Suspense key={search} fallback={<DigestGridSkeleton />}>
          <DigestGrid userId={user.id} search={search} />
        </Suspense>
      </div>
    </main>
  );
}
