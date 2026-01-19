"use client";

import { useRouter } from "next/navigation";
import { UrlInput } from "@/components/url-input";
import { RecentDigests } from "@/components/recent-digests";

export function HomeContent() {
  const router = useRouter();

  const handleDigestComplete = (digestId: string) => {
    router.push(`/digest/${digestId}`);
  };

  return (
    <>
      <div className="max-w-2xl mx-auto text-center space-y-6 py-6 md:py-8">
        <h1 className="text-4xl md:text-5xl text-[var(--color-text-primary)] font-semibold tracking-tight">
          Your YouTube, indexed
        </h1>

        <UrlInput onDigestComplete={handleDigestComplete} />
      </div>

      <RecentDigests />
    </>
  );
}
