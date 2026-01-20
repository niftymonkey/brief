"use client";

import * as React from "react";
import { useState } from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronRight, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseTimestamp } from "./timestamp";
import type { ContentSection, KeyPoint } from "@/lib/types";

interface SectionAccordionProps {
  sections: ContentSection[];
  videoId: string;
}

function isKeyPointArray(keyPoints: KeyPoint[] | string[]): keyPoints is KeyPoint[] {
  return keyPoints.length > 0 && typeof keyPoints[0] === "object";
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
  const allSectionValues = sections.map((_, index) => `section-${index}`);
  const [openSections, setOpenSections] = useState<string[]>([]);

  const allExpanded = openSections.length === sections.length;

  const toggleAll = () => {
    if (allExpanded) {
      setOpenSections([]);
    } else {
      setOpenSections(allSectionValues);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          onClick={toggleAll}
          className="inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          <ChevronsUpDown className="w-3 h-3" />
          {allExpanded ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <AccordionPrimitive.Root
        type="multiple"
        value={openSections}
        onValueChange={setOpenSections}
        className="space-y-2"
      >
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
                  {isKeyPointArray(section.keyPoints)
                    ? section.keyPoints.map((kp, kpIndex) => (
                        <li
                          key={kpIndex}
                          className={cn(
                            "list-disc list-outside ml-4",
                            kp.isTangent
                              ? "text-[var(--color-text-tertiary)] italic"
                              : "text-[var(--color-text-primary)]"
                          )}
                        >
                          {kp.isTangent && (
                            <span className="text-[var(--color-text-tertiary)] not-italic mr-1">[tangent]</span>
                          )}
                          {kp.text}
                        </li>
                      ))
                    : section.keyPoints.map((text, kpIndex) => (
                        <li
                          key={kpIndex}
                          className="text-[var(--color-text-primary)] list-disc list-outside ml-4"
                        >
                          {text}
                        </li>
                      ))}
                </ul>
              </div>
            </AccordionPrimitive.Content>
          </AccordionPrimitive.Item>
        ))}
      </AccordionPrimitive.Root>
    </div>
  );
}
