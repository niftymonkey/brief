"use client";

import { useState } from "react";
import { Header } from "@/components/header";
import { UrlInput } from "@/components/url-input";
import { DigestResult } from "@/components/digest-result";
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
      <main className="flex-1 px-4 py-8">
        {digestData ? (
          <DigestResult
            metadata={digestData.metadata}
            digest={digestData.digest}
            onReset={handleReset}
          />
        ) : (
          <div className="max-w-2xl mx-auto text-center space-y-8 py-8 md:py-16">
            <h1 className="font-serif text-4xl md:text-5xl text-[var(--color-text-primary)]">
              Transform YouTube videos
              <br />
              into study guides
            </h1>

            <UrlInput onDigestComplete={handleDigestComplete} />

            <p className="text-[var(--color-text-secondary)] text-base">
              Paste any YouTube link to generate a timestamped digest
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
