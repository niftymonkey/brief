"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Check, Loader2 } from "lucide-react";

interface RegenerateDigestButtonProps {
  digestId: string;
  videoId: string;
}

type Step = "metadata" | "transcript" | "analyzing" | "saving" | "complete" | "error";

const STEPS: { key: Step; label: string }[] = [
  { key: "metadata", label: "Fetching video info" },
  { key: "transcript", label: "Extracting transcript" },
  { key: "analyzing", label: "Analyzing content" },
  { key: "saving", label: "Saving digest" },
];

export function RegenerateDigestButton({ digestId, videoId }: RegenerateDigestButtonProps) {
  const router = useRouter();
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [currentStep, setCurrentStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    setCurrentStep("metadata");
    setError(null);

    try {
      const response = await fetch(`/api/digest/${digestId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));
            setCurrentStep(data.step);

            if (data.step === "error") {
              setError(data.message);
            } else if (data.step === "complete") {
              setTimeout(() => {
                setIsRegenerating(false);
                setShowConfirm(false);
                setCurrentStep(null);
                router.refresh();
              }, 500);
            }
          }
        }
      }
    } catch {
      setError("Failed to regenerate digest");
    }
  };

  const getStepStatus = (stepKey: Step): "pending" | "active" | "complete" => {
    if (!currentStep) return "pending";
    const currentIndex = STEPS.findIndex((s) => s.key === currentStep);
    const stepIndex = STEPS.findIndex((s) => s.key === stepKey);

    if (currentStep === "complete" || currentStep === "saving") {
      return stepIndex <= STEPS.findIndex((s) => s.key === "saving") ? "complete" : "pending";
    }
    if (stepIndex < currentIndex) return "complete";
    if (stepIndex === currentIndex) return "active";
    return "pending";
  };

  // Progress overlay
  if (isRegenerating) {
    return (
      <>
        {/* Backdrop */}
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          {/* Progress card */}
          <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-6">
              <RefreshCw className={`w-5 h-5 ${error ? "text-red-500" : "text-[var(--color-accent)] animate-spin"}`} />
              <h3 className="text-lg font-medium text-[var(--color-text-primary)]">
                {error ? "Regeneration Failed" : "Regenerating Digest"}
              </h3>
            </div>

            {error ? (
              <div className="space-y-4">
                <p className="text-red-500 text-sm">
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
                <button
                  onClick={() => {
                    setIsRegenerating(false);
                    setShowConfirm(false);
                    setCurrentStep(null);
                    setError(null);
                  }}
                  className="w-full py-2 px-4 bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] rounded-lg transition-colors text-sm"
                >
                  Close
                </button>
              </div>
            ) : (
              <ul className="space-y-3">
                {STEPS.map((step) => {
                  const status = getStepStatus(step.key);
                  return (
                    <li key={step.key} className="flex items-center gap-3">
                      {status === "complete" ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : status === "active" ? (
                        <Loader2 className="w-4 h-4 text-[var(--color-accent)] animate-spin" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-[var(--color-border)]" />
                      )}
                      <span
                        className={
                          status === "active"
                            ? "text-[var(--color-text-primary)]"
                            : status === "complete"
                            ? "text-[var(--color-text-secondary)]"
                            : "text-[var(--color-text-tertiary)]"
                        }
                      >
                        {step.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Original button (hidden behind overlay) */}
        <button disabled className="inline-flex items-center gap-1 text-[var(--color-text-tertiary)] text-sm opacity-50">
          <RefreshCw className="w-4 h-4" />
        </button>
      </>
    );
  }

  if (showConfirm) {
    return (
      <div className="flex items-center gap-2">
        <RefreshCw className="w-4 h-4 text-[var(--color-text-tertiary)]" />
        <span className="text-sm text-[var(--color-text-secondary)]">Regenerate?</span>
        <button
          onClick={handleRegenerate}
          className="text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
        >
          Yes
        </button>
        <button
          onClick={() => setShowConfirm(false)}
          className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      className="inline-flex items-center gap-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] transition-colors text-sm"
      title="Regenerate digest"
    >
      <RefreshCw className="w-4 h-4" />
    </button>
  );
}
