"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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

interface NewBriefDialogProps {
  variant?: VariantProps<typeof buttonVariants>["variant"];
}

export function NewBriefDialog({ variant = "default" }: NewBriefDialogProps) {
  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [currentStep, setCurrentStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isNavigating, startNavigation] = useTransition();
  const router = useRouter();

  const handleLoadingStart = () => {
    setOpen(false);
    setIsCreating(true);
  };

  const handleStepChange = (step: Step | null) => {
    setCurrentStep(step);
  };

  const handleError = (err: string | null) => {
    setError(err);
  };

  /**
   * Hands the finished brief to the router. The navigation runs inside a
   * transition, so `isNavigating` stays true until the brief page has rendered,
   * and the state updates inside it are deferred to that same commit. Together
   * they hold the progress modal on screen, still showing "Redirecting", until
   * the user is actually on the brief. Clearing the run-scoped step and error
   * in that commit closes the modal with no state left over for the next run.
   */
  const handleBriefComplete = (briefId: string) => {
    setCurrentStep("redirecting");
    startNavigation(() => {
      setIsCreating(false);
      setCurrentStep(null);
      setError(null);
      router.push(`/brief/${briefId}`);
      router.refresh();
    });
  };

  const handleProgressClose = () => {
    setIsCreating(false);
    setCurrentStep(null);
    setError(null);
  };

  return (
    <>
      <ProgressModal
        isOpen={isCreating || isNavigating}
        title="Creating Brief"
        errorTitle="Failed to Create Brief"
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
            New Brief
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Create a new brief</DialogTitle>
            <DialogDescription>
              Paste a YouTube URL to generate a structured summary with timestamps, key insights, and extracted links.
            </DialogDescription>
          </DialogHeader>
          <UrlInput
            onBriefComplete={handleBriefComplete}
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
