import { Suspense } from "react";
import Link from "next/link";
import { Youtube, Clock, BookOpen, LinkIcon, ArrowRight } from "lucide-react";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { Header } from "@/components/header";
import { DigestCard } from "@/components/digest-card";
import { DigestSearch } from "@/components/digest-search";
import { NewDigestDialog } from "@/components/new-digest-dialog";
import { getDigests } from "@/lib/db";
import { isEmailAllowed } from "@/lib/access";
import { cn } from "@/lib/utils";

interface PageProps {
  searchParams: Promise<{ search?: string }>;
}

// Landing page features
const features = [
  {
    icon: Clock,
    title: "Smart Timestamps",
    description: "Jump to any section instantly with AI-generated timestamps",
  },
  {
    icon: BookOpen,
    title: "Key Insights",
    description: "Get the main points without watching the entire video",
  },
  {
    icon: LinkIcon,
    title: "Extracted Links",
    description: "All resources mentioned in the video, organized for you",
  },
];

function LandingPage() {
  return (
    <main className="flex-1">
      {/* Hero Section */}
      <section className="px-4 py-12 md:py-16">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent)] mb-6">
            <Youtube className="w-4 h-4" />
            <span className="text-sm font-medium">YouTube Digest</span>
          </div>

          <h1 className="text-5xl md:text-6xl lg:text-7xl font-heading font-semibold text-[var(--color-text-primary)] tracking-tight mb-6">
            Your YouTube,
            <br />
            <span className="text-[var(--color-accent)]">indexed</span>
          </h1>

          <p className="text-lg md:text-xl text-[var(--color-text-secondary)] max-w-2xl mx-auto mb-8">
            Transform any YouTube video into a structured study guide. Get
            AI-powered summaries, timestamps, and extracted links in seconds.
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

      {/* Features Section */}
      <section className="px-4 py-12 border-t border-[var(--color-border)]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-heading font-semibold text-[var(--color-text-primary)] text-center mb-8">
            Everything you need to learn faster
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="p-6 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]"
              >
                <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-subtle)] flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-[var(--color-accent)]" />
                </div>
                <h3 className="text-lg font-heading font-semibold text-[var(--color-text-primary)] mb-2">
                  {feature.title}
                </h3>
                <p className="text-[var(--color-text-secondary)]">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="px-4 py-12 border-t border-[var(--color-border)]">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-heading font-semibold text-[var(--color-text-primary)] mb-4">
            Ready to save hours of learning time?
          </h2>
          <p className="text-[var(--color-text-secondary)] mb-6">
            Start digesting your favorite YouTube videos today.
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
  );
}

async function DigestGrid({ userId, search, hasAccess }: { userId: string; search?: string; hasAccess: boolean }) {
  const { digests } = await getDigests({ userId, search, limit: 50 });

  if (digests.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--color-text-secondary)]">
          {search ? "No digests match your search" : "No digests yet"}
        </p>
        {!search && hasAccess && (
          <div className="mt-4">
            <NewDigestDialog variant="outline" />
          </div>
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

async function AuthenticatedDashboard({ search }: { search?: string }) {
  const { user } = await withAuth();

  if (!user) {
    return <LandingPage />;
  }

  const hasAccess = isEmailAllowed(user.email);
  const { total } = await getDigests({ userId: user.id, limit: 1 });

  return (
    <>
      <Header />
      <main className="flex-1 px-4 py-4 md:py-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-heading font-semibold text-[var(--color-text-primary)]">
              Your Library
            </h2>
            <span className="text-[var(--color-text-secondary)]">
              {total} {total === 1 ? "digest" : "digests"} saved
            </span>
          </div>

          <DigestSearch />

          <Suspense key={search} fallback={<DigestGridSkeleton />}>
            <DigestGrid userId={user.id} search={search} hasAccess={hasAccess} />
          </Suspense>
        </div>
      </main>
    </>
  );
}

export default async function RootPage({ searchParams }: PageProps) {
  const { user } = await withAuth();
  const { search } = await searchParams;

  if (!user) {
    return <LandingPage />;
  }

  return <AuthenticatedDashboard search={search} />;
}
