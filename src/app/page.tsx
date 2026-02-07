import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { Header } from "@/components/header";
import { LandingHeader } from "@/components/landing-header";
import { NewDigestDialog } from "@/components/new-digest-dialog";
import { AccessRestricted } from "@/components/access-restricted";
import {
  LibraryShell,
  DigestGridSkeleton,
} from "@/components/library-content";
import { FilteredDigestGrid } from "@/components/filtered-digest-grid";
import { getDigests, getUserTags } from "@/lib/db";
import { isEmailAllowed } from "@/lib/access";
import { cn } from "@/lib/utils";

interface PageProps {
  searchParams: Promise<{
    search?: string;
  }>;
}

function LandingPage() {
  return (
    <>
      <LandingHeader />
      <main className="flex-1">
        {/* Hero Section */}
        <section className="px-4 py-12 md:py-16">
          <div className="max-w-5xl mx-auto text-center">
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-heading font-semibold text-[var(--color-text-primary)] tracking-tight mb-6">
              Your YouTube,
              <br />
              <span className="text-[var(--color-accent)]">indexed</span>
            </h1>

            <p className="text-lg md:text-xl text-[var(--color-text-secondary)] max-w-2xl mx-auto mb-4">
              AI summaries help you decide if it you should watch it now,
              later, or never. Timestamped chapters let you jump to what
              matters.
            </p>

            <p className="text-sm text-[var(--color-text-tertiary)] mb-8">
              Full-text digest search · Shareable digests
            </p>

            <Link
              href="/auth"
              prefetch={false}
              className={cn(
                "inline-flex items-center gap-2 px-6 py-3 rounded-xl text-lg font-medium cursor-pointer",
                "bg-[var(--color-accent)] text-white",
                "hover:bg-[var(--color-accent-hover)] transition-colors"
              )}
            >
              Get Started
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}

async function DigestGridContent({
  userId,
  search,
  hasAccess,
}: {
  userId: string;
  search?: string;
  hasAccess: boolean;
}) {
  // Server only filters by search (full-text search needs the DB)
  // Tags and dates are filtered client-side for instant UX
  const { digests } = await getDigests({ userId, search, limit: 500 });

  if (digests.length === 0 && !search) {
    if (!hasAccess) {
      return <AccessRestricted />;
    }

    return (
      <div className="text-center py-12">
        <p className="text-[var(--color-text-secondary)]">No digests yet</p>
        <div className="mt-4">
          <NewDigestDialog variant="outline" />
        </div>
      </div>
    );
  }

  if (digests.length === 0 && search) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--color-text-secondary)]">
          No digests match your search
        </p>
      </div>
    );
  }

  return <FilteredDigestGrid digests={digests} hasAccess={hasAccess} />;
}

async function AuthenticatedDashboard({ search }: { search?: string }) {
  const { user } = await withAuth();

  if (!user) {
    return <LandingPage />;
  }

  const hasAccess = isEmailAllowed(user.email);
  const [{ total }, availableTags] = await Promise.all([
    getDigests({ userId: user.id, limit: 1 }),
    getUserTags(user.id),
  ]);

  return (
    <>
      <Header />
      <LibraryShell availableTags={availableTags}>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-lg font-heading font-semibold text-[var(--color-text-primary)]">
            Your Library
          </h2>
          <span className="text-[var(--color-text-secondary)]">
            {total} {total === 1 ? "digest" : "digests"} saved
          </span>
        </div>

        <Suspense fallback={<DigestGridSkeleton />}>
          <DigestGridContent
            userId={user.id}
            search={search}
            hasAccess={hasAccess}
          />
        </Suspense>
      </LibraryShell>
    </>
  );
}

export default async function RootPage({ searchParams }: PageProps) {
  const params = await searchParams;

  return <AuthenticatedDashboard search={params.search} />;
}
