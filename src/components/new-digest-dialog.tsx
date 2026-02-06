"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Plus, Youtube } from "lucide-react";
import { Button, type buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ProgressModal, type Step } from "@/components/progress-modal";
import { UrlInput } from "@/components/url-input";
import type { VariantProps } from "class-variance-authority";

interface NewDigestDialogProps {
  variant?: VariantProps<typeof buttonVariants>["variant"];
}

export function NewDigestDialog({ variant = "default" }: NewDigestDialogProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Close the progress modal when the route changes after navigation
  useEffect(() => {
    if (isLoading && currentStep === "redirecting") {
      setIsLoading(false);
      setCurrentStep(null);
      setError(null);
    }
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadingStart = () => {
    setOpen(false);
    setIsLoading(true);
  };

  const handleStepChange = (step: Step | null) => {
    setCurrentStep(step);
  };

  const handleError = (err: string | null) => {
    setError(err);
  };

  const handleDigestComplete = (digestId: string) => {
    setCurrentStep("redirecting");
    router.push(`/digest/${digestId}`);
    router.refresh();
  };

  const handleProgressClose = () => {
    setIsLoading(false);
    setCurrentStep(null);
    setError(null);
  };

  return (
    <>
      <ProgressModal
        isOpen={isLoading}
        title="Creating Digest"
        errorTitle="Failed to Create Digest"
        icon={Youtube}
        currentStep={currentStep}
        error={error}
        onClose={handleProgressClose}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            variant={variant}
            className={variant === "default" ? "bg-[var(--color-accent-dark)] !text-white hover:bg-[var(--color-accent)]" : undefined}
          >
            <Plus className="w-4 h-4" />
            New Digest
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Create a new digest</DialogTitle>
            <DialogDescription>
              Paste a YouTube URL to generate a structured summary with timestamps, key insights, and extracted links.
            </DialogDescription>
          </DialogHeader>
          <UrlInput
            onDigestComplete={handleDigestComplete}
            onLoadingStart={handleLoadingStart}
            onStepChange={handleStepChange}
            onError={handleError}
            showProgressModal={false}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
