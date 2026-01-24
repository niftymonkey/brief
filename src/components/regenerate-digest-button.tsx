"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ProgressModal, type Step } from "@/components/progress-modal";

interface RegenerateDigestButtonProps {
  digestId: string;
  videoId: string;
}

export function RegenerateDigestButton({ digestId, videoId }: RegenerateDigestButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Close modal when refresh transition completes
  useEffect(() => {
    if (isRefreshing && !isPending) {
      setIsRegenerating(false);
      setIsRefreshing(false);
      setCurrentStep(null);
    }
  }, [isPending, isRefreshing]);

  const handleRegenerate = async () => {
    setOpen(false);
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

            if (data.step === "error") {
              setCurrentStep(data.step);
              setError(data.message);
            } else if (data.step === "complete") {
              setCurrentStep("redirecting");
              setIsRefreshing(true);
              startTransition(() => {
                router.refresh();
              });
            } else {
              setCurrentStep(data.step);
            }
          }
        }
      }
    } catch {
      setError("Failed to regenerate digest");
    }
  };

  const handleClose = () => {
    setIsRegenerating(false);
    setCurrentStep(null);
    setError(null);
  };

  return (
    <>
      <ProgressModal
        isOpen={isRegenerating}
        title="Regenerating Digest"
        errorTitle="Regeneration Failed"
        icon={RefreshCw}
        iconSpins={true}
        currentStep={currentStep}
        error={error}
        onClose={handleClose}
        redirectingLabel="Refreshing content"
      />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            className="text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-tertiary)]"
            title="Regenerate digest"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-auto p-3 rounded-xl bg-[var(--color-bg-secondary)] border-[var(--color-border)]"
        >
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--color-text-primary)]">
              Regenerate digest?
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRegenerate}
                className="text-sm font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] cursor-pointer"
              >
                Yes
              </button>
              <button
                onClick={() => setOpen(false)}
                className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer"
              >
                No
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
