"use client";

import { useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface UrlInputProps {
  onDigestComplete: (digestId: string) => void;
}

type Step = "metadata" | "transcript" | "analyzing" | "saving" | "complete" | "error";

interface ProgressState {
  step: Step;
  message: string;
}

const STEPS: Step[] = ["metadata", "transcript", "analyzing", "saving"];

const STEP_LABELS: Record<Step, string> = {
  metadata: "Fetching video info",
  transcript: "Extracting transcript",
  analyzing: "Analyzing content",
  saving: "Saving digest",
  complete: "Done",
  error: "Error",
};

export function UrlInput({ onDigestComplete }: UrlInputProps) {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setProgress(null);

    if (!url.trim()) {
      setError("Please enter a YouTube URL");
      return;
    }

    const isYouTubeUrl = url.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)/
    );

    if (!isYouTubeUrl) {
      setError("Please enter a valid YouTube URL");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to create digest");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));
            console.log(`[DIGEST CLIENT] Received event:`, data);
            setProgress({ step: data.step, message: data.message });

            if (data.step === "error") {
              console.error(`[DIGEST CLIENT] Error received:`, data.message);
              throw new Error(data.message);
            }

            if (data.step === "complete" && data.data?.digestId) {
              console.log(`[DIGEST CLIENT] Complete! DigestId:`, data.data.digestId);
              onDigestComplete(data.data.digestId);
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
      setProgress(null);
    }
  };

  const currentStepIndex = progress ? STEPS.indexOf(progress.step) : -1;

  return (
    <div className="w-full max-w-xl mx-auto">
      <form onSubmit={handleSubmit}>
        <div className="relative group">
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder="Paste a YouTube URL..."
            disabled={isLoading}
            className={cn(
              "w-full px-5 py-3.5 text-lg",
              "bg-[var(--color-bg-secondary)] border rounded-xl",
              "placeholder:text-[var(--color-text-tertiary)]",
              "focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20",
              "transition-all duration-200",
              "group-hover:border-[var(--color-border-hover)]",
              "disabled:opacity-60 disabled:cursor-not-allowed",
              error
                ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                : "border-[var(--color-border)]"
            )}
          />
          <button
            type="submit"
            disabled={isLoading || !url.trim()}
            className={cn(
              "absolute right-1.5 top-1.5 bottom-1.5",
              "px-4 rounded-lg bg-[var(--color-accent)] text-white",
              "flex items-center justify-center",
              "hover:bg-[var(--color-accent-hover)] transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <ArrowRight className="w-5 h-5" />
            )}
          </button>
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-500 text-center">
            {error.includes("credit balance") ? (
              <>
                Your credit balance is too low to access the Anthropic API.{" "}
                <a
                  href="https://console.anthropic.com/settings/plans"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-red-400"
                >
                  Upgrade or purchase credits
                </a>
              </>
            ) : error.includes("quota exceeded") ? (
              <>
                YouTube API quota exceeded for today.{" "}
                <a
                  href="https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-red-400"
                >
                  Check quota usage
                </a>
              </>
            ) : error.includes("Supadata") ? (
              <>
                Supadata API credits exhausted.{" "}
                <a
                  href="https://dash.supadata.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-red-400"
                >
                  Add credits in your dashboard
                </a>
              </>
            ) : (
              error
            )}
          </p>
        )}
      </form>

      {/* Progress indicator */}
      {isLoading && progress && (
        <div className="mt-6 p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
          <div className="space-y-3">
            {STEPS.map((step, index) => {
              const isComplete = index < currentStepIndex;
              const isCurrent = index === currentStepIndex;

              return (
                <div key={step} className="flex items-center gap-3">
                  <div
                    className={cn(
                      "w-5 h-5 rounded-full flex items-center justify-center",
                      isComplete && "bg-green-500 text-white",
                      isCurrent && "bg-[var(--color-accent)] text-white",
                      !isComplete && !isCurrent && "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]"
                    )}
                  >
                    {isComplete ? (
                      <Check className="w-3 h-3" />
                    ) : isCurrent ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-current" />
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-sm",
                      isComplete && "text-[var(--color-text-secondary)]",
                      isCurrent && "text-[var(--color-text-primary)] font-medium",
                      !isComplete && !isCurrent && "text-[var(--color-text-tertiary)]"
                    )}
                  >
                    {STEP_LABELS[step]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
