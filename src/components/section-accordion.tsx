"use client";

import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseTimestamp } from "./timestamp";
import type { ContentSection } from "@/lib/types";

interface SectionAccordionProps {
  sections: ContentSection[];
  videoId: string;
}

function TimestampLink({
  time,
  videoId
}: {
  time: string;
  videoId: string;
}) {
  const seconds = parseTimestamp(time);
  const url = `https://youtube.com/watch?v=${videoId}&t=${seconds}s`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "font-mono text-sm",
        "text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]",
        "transition-colors"
      )}
    >
      {time}
    </a>
  );
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
                "flex items-center justify-between w-full px-3 py-2 md:px-4 md:py-3",
                "text-left font-medium text-[var(--color-text-primary)]",
                "hover:bg-[var(--color-bg-tertiary)] transition-colors",
                "group"
              )}
            >
              <div className="flex items-center gap-3">
                <ChevronRight className="w-4 h-4 text-[var(--color-text-tertiary)] transition-transform group-data-[state=open]:rotate-90" />
                <span>{section.title}</span>
              </div>
              <TimestampLink
                time={section.timestampStart}
                videoId={videoId}
              />
            </AccordionPrimitive.Trigger>
          </AccordionPrimitive.Header>

          <AccordionPrimitive.Content className="overflow-hidden data-[state=open]:animate-slideDown data-[state=closed]:animate-slideUp">
            <div className="px-3 pb-3 pt-1 md:px-4 md:pb-4 md:pt-2">
              <ul className="space-y-2">
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
