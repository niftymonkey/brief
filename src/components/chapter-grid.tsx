"use client";

import { useState } from "react";
import { ChevronRight, ChevronsUpDown } from "lucide-react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { parseTimestamp } from "./timestamp";
import { cn } from "@/lib/utils";
import type { ContentSection, KeyPoint } from "@/lib/types";

interface ChapterGridProps {
  sections: ContentSection[];
  videoId: string;
  hasCreatorChapters?: boolean | null;
}

function isKeyPointArray(keyPoints: KeyPoint[] | string[]): keyPoints is KeyPoint[] {
  return keyPoints.length > 0 && typeof keyPoints[0] === "object";
}

function TimestampLink({ time, videoId }: { time: string; videoId: string }) {
  const seconds = parseTimestamp(time);
  const url = `https://youtube.com/watch?v=${videoId}&t=${seconds}s`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="font-mono text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
    >
      {time}
    </a>
  );
}

export function ChapterGrid({ sections, videoId, hasCreatorChapters }: ChapterGridProps) {
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
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between mb-1.5 pb-1 border-b border-[var(--color-border)]">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Chapters
          </h2>
          {hasCreatorChapters !== null && hasCreatorChapters !== undefined && (
            <span className="text-[var(--color-text-tertiary)]">
              ({hasCreatorChapters ? "creator supplied" : "AI-generated"})
            </span>
          )}
        </div>
        <button
          onClick={toggleAll}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer"
        >
          <ChevronsUpDown className="w-4 h-4" />
          {allExpanded ? "Collapse all" : "Expand all"}
        </button>
      </div>

      <Accordion
        type="multiple"
        value={openSections}
        onValueChange={setOpenSections}
        className="space-y-1.5"
      >
        {sections.map((section, index) => (
          <AccordionItem
            key={index}
            value={`section-${index}`}
            className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-bg-secondary)] last:border-b"
          >
            <AccordionTrigger
              className={cn(
                "flex items-center justify-between w-full px-3 py-2 cursor-pointer",
                "text-left font-medium text-[var(--color-text-primary)]",
                "hover:bg-[var(--color-bg-tertiary)] hover:no-underline transition-all",
                "[&>svg]:hidden"
              )}
            >
              <div className="flex items-center gap-2 flex-1">
                <ChevronRight className="w-4 h-4 text-[var(--color-text-tertiary)] transition-transform [[data-state=open]_&]:rotate-90 shrink-0" />
                <span className="text-lg">{section.title}</span>
              </div>
              <TimestampLink time={section.timestampStart} videoId={videoId} />
            </AccordionTrigger>

            <AccordionContent className="px-3 py-2">
              <ul className="space-y-1 ml-6 text-lg">
                {isKeyPointArray(section.keyPoints)
                  ? section.keyPoints.map((kp, kpIndex) => (
                      <li
                        key={kpIndex}
                        className={cn(
                          "list-disc list-outside",
                          kp.isTangent
                            ? "text-[var(--color-text-tertiary)] italic"
                            : "text-[var(--color-text-primary)]"
                        )}
                      >
                        {kp.isTangent && (
                          <span className="text-[var(--color-warning)] not-italic mr-1">
                            [tangent]
                          </span>
                        )}
                        {kp.text}
                      </li>
                    ))
                  : section.keyPoints.map((text, kpIndex) => (
                      <li
                        key={kpIndex}
                        className="text-[var(--color-text-primary)] list-disc list-outside"
                      >
                        {text}
                      </li>
                    ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
