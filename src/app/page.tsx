"use client";

import { useState } from "react";
import { Header } from "@/components/header";
import { UrlInput } from "@/components/url-input";
import { DigestResult } from "@/components/digest-result";
import { RecentDigests } from "@/components/recent-digests";
import type { VideoMetadata, StructuredDigest } from "@/lib/types";

interface DigestData {
  metadata: VideoMetadata;
  digest: StructuredDigest;
}

export default function Home() {
  const [digestData, setDigestData] = useState<DigestData | null>(null);

  const handleDigestComplete = (data: DigestData) => {
    setDigestData(data);
  };

  const handleReset = () => {
    setDigestData(null);
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 px-4 py-4 md:py-8">
        {digestData ? (
          <DigestResult
            metadata={digestData.metadata}
            digest={digestData.digest}
            onReset={handleReset}
          />
        ) : (
          <>
            <div className="max-w-2xl mx-auto text-center space-y-6 py-8 md:py-12">
              <h1 className="text-4xl md:text-5xl text-[var(--color-text-primary)] font-semibold tracking-tight">
                Your YouTube, indexed
              </h1>

              <UrlInput onDigestComplete={handleDigestComplete} />
            </div>

            <RecentDigests />
          </>
        )}
      </main>
    </div>
  );
}
