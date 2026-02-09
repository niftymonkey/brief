"use client";

import { useState } from "react";
import { ArrowRight, Loader2, Youtube } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ProgressModal, type Step } from "@/components/progress-modal";

interface UrlInputProps {
  onBriefComplete: (briefId: string) => void;
  onLoadingStart?: () => void;
  onStepChange?: (step: Step | null) => void;
  onError?: (error: string | null) => void;
  showProgressModal?: boolean;
}

export function UrlInput({
  onBriefComplete,
  onLoadingStart,
  onStepChange,
  onError,
  showProgressModal = true
}: UrlInputProps) {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<Step | null>(null);

  const updateStep = (step: Step | null) => {
    setCurrentStep(step);
    onStepChange?.(step);
  };

  const updateError = (err: string | null) => {
    setError(err);
    onError?.(err);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    updateError(null);
    updateStep(null);

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
    updateStep("metadata");
    onLoadingStart?.();

    try {
      const response = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to create brief");
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

            if (data.step === "error") {
              updateStep(data.step);
              updateError(data.message);
            } else if (data.step === "complete") {
              if (data.data?.briefId) {
                updateStep("redirecting");
                onBriefComplete(data.data.briefId);
              } else {
                updateStep("error");
                updateError("Brief completed but no ID was returned");
              }
            } else {
              updateStep(data.step);
            }
          }
        }
      }
    } catch (err) {
      updateError(err instanceof Error ? err.message : "Something went wrong");
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setIsLoading(false);
    updateStep(null);
    updateError(null);
  };

  // Validation errors (shown inline)
  const isValidationError = error && (
    error === "Please enter a YouTube URL" ||
    error === "Please enter a valid YouTube URL"
  );

  return (
    <>
      {showProgressModal && (
        <ProgressModal
          isOpen={isLoading}
          title="Creating Brief"
          errorTitle="Failed to Create Brief"
          icon={Youtube}
          currentStep={currentStep}
          error={error}
          onClose={handleClose}
        />
      )}

      {/* URL Input Form */}
      <div className="w-full max-w-xl mx-auto">
        <form onSubmit={handleSubmit}>
          <div className="relative group">
            <Input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              placeholder="Paste a YouTube URL..."
              disabled={isLoading}
              className={cn(
                "w-full h-auto px-5 py-3.5 text-lg",
                "bg-[var(--color-bg-secondary)] border-[var(--color-border)] rounded-xl",
                "placeholder:text-[var(--color-text-tertiary)]",
                "transition-all duration-200",
                "group-hover:border-[var(--color-border-hover)]",
                isValidationError && "border-red-500"
              )}
            />
            <button
              type="submit"
              disabled={isLoading || !url.trim()}
              className={cn(
                "absolute right-1.5 top-1.5 bottom-1.5",
                "px-4 rounded-lg bg-[var(--color-accent)] text-white cursor-pointer",
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
          {isValidationError && (
            <p className="mt-2 text-sm text-red-500 text-center">{error}</p>
          )}
        </form>
      </div>
    </>
  );
}
