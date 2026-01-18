"use client";

import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Timestamp } from "./timestamp";
import type { ContentSection } from "@/lib/types";

interface SectionAccordionProps {
  sections: ContentSection[];
  videoId: string;
}

export function SectionAccordion({ sections, videoId }: SectionAccordionProps) {
  return (
    <AccordionPrimitive.Root type="multiple" className="space-y-2">
      {sections.map((section, index) => (
        <AccordionPrimitive.Item
          key={index}
          value={`section-${index}`}
          className="border border-[var(--color-border)] rounded-xl overflow-hidden bg-[var(--color-bg-secondary)]"
        >
          <AccordionPrimitive.Header>
            <AccordionPrimitive.Trigger
              className={cn(
                "flex items-center justify-between w-full px-4 py-3",
                "text-left font-medium text-[var(--color-text-primary)]",
                "hover:bg-[var(--color-bg-tertiary)] transition-colors",
                "group"
              )}
            >
              <div className="flex items-center gap-3">
                <ChevronRight className="w-4 h-4 text-[var(--color-text-tertiary)] transition-transform group-data-[state=open]:rotate-90" />
                <span>{section.title}</span>
              </div>
              <span className="font-mono text-sm text-[var(--color-text-secondary)]">
                {section.timestampStart}
              </span>
            </AccordionPrimitive.Trigger>
          </AccordionPrimitive.Header>

          <AccordionPrimitive.Content className="overflow-hidden data-[state=open]:animate-slideDown data-[state=closed]:animate-slideUp">
            <div className="px-4 pb-4 pt-0 space-y-3">
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                <Timestamp time={section.timestampStart} videoId={videoId} />
                <span>-</span>
                <Timestamp time={section.timestampEnd} videoId={videoId} />
              </div>

              <ul className="space-y-2 pl-4">
                {section.keyPoints.map((point, pointIndex) => (
                  <li
                    key={pointIndex}
                    className="text-[var(--color-text-primary)] list-disc list-outside ml-4"
                  >
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </AccordionPrimitive.Content>
        </AccordionPrimitive.Item>
      ))}
    </AccordionPrimitive.Root>
  );
}
