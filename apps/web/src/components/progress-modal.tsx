"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, type LucideIcon } from "lucide-react";

type Step = "metadata" | "transcript" | "analyzing" | "saving" | "redirecting" | "complete" | "error";

const STEPS: { key: Step; label: string }[] = [
  { key: "metadata", label: "Fetching video info" },
  { key: "transcript", label: "Extracting transcript" },
  { key: "analyzing", label: "Analyzing content" },
  { key: "saving", label: "Saving brief" },
  { key: "redirecting", label: "Redirecting" },
];

interface ProgressModalProps {
  isOpen: boolean;
  title: string;
  errorTitle: string;
  icon: LucideIcon;
  iconSpins?: boolean;
  currentStep: Step | null;
  error: string | null;
  onClose: () => void;
  redirectingLabel?: string;
}

function getStepStatus(currentStep: Step | null, stepKey: Step): "pending" | "active" | "complete" {
  if (!currentStep) return "pending";
  const currentIndex = STEPS.findIndex((s) => s.key === currentStep);
  const stepIndex = STEPS.findIndex((s) => s.key === stepKey);

  // When complete, show all steps as complete
  if (currentStep === "complete") {
    return "complete";
  }
  // When redirecting, show all prior steps as complete, redirecting as active
  if (currentStep === "redirecting") {
    if (stepKey === "redirecting") return "active";
    return "complete";
  }
  // When saving, show saving as active (not complete yet)
  if (currentStep === "saving") {
    if (stepKey === "saving") return "active";
    return stepIndex < currentIndex ? "complete" : "pending";
  }
  if (stepIndex < currentIndex) return "complete";
  if (stepIndex === currentIndex) return "active";
  return "pending";
}

function ErrorMessage({ error }: { error: string }) {
  if (error.includes("credit balance")) {
    return (
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
    );
  }

  if (error.includes("quota exceeded")) {
    return (
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
    );
  }

  if (error.includes("Supadata")) {
    return (
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
    );
  }

  return <>{error}</>;
}

export function ProgressModal({
  isOpen,
  title,
  errorTitle,
  icon: Icon,
  iconSpins = false,
  currentStep,
  error,
  onClose,
  redirectingLabel = "Redirecting",
}: ProgressModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex justify-center animate-in fade-in-0 duration-200">
      <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-xl p-6 shadow-lg max-w-sm w-full mx-4 h-fit mt-[20vh] animate-in fade-in-0 zoom-in-95 duration-200">
        <div className="flex items-center gap-3 mb-6">
          <Icon
            className={`w-5 h-5 ${
              error
                ? "text-red-500"
                : iconSpins
                ? "text-[var(--color-accent)] animate-spin"
                : "text-[var(--color-accent)]"
            }`}
          />
          <h3 className="text-lg font-medium text-[var(--color-text-primary)]">
            {error ? errorTitle : title}
          </h3>
        </div>

        {error ? (
          <div className="space-y-4">
            <p className="text-red-500 text-sm">
              <ErrorMessage error={error} />
            </p>
            <button
              onClick={onClose}
              className="w-full py-2 px-4 bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] rounded-lg transition-colors text-sm cursor-pointer"
            >
              Close
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {STEPS.map((step) => {
              const status = getStepStatus(currentStep, step.key);
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
                    {step.key === "redirecting" ? redirectingLabel : step.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body
  );
}

export type { Step };
