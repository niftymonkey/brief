"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TopicSection } from "@/components/topics/topic-section";
import { updateTopicSettingsAction } from "@/app/(app)/topics/actions";
import {
  parseTopicSettings,
  toTopicSettingsFields,
  type TopicSettings,
  type TopicSettingsFields,
} from "@/lib/topic-settings-input";

interface TopicSettingsCardProps {
  topicId: string;
  settings: TopicSettings;
  editable: boolean;
}

interface SettingRow {
  key: keyof TopicSettings;
  label: string;
  hint: string;
  min: number;
}

const SCHEDULE_ROWS: SettingRow[] = [
  {
    key: "cadenceDays",
    label: "Survey every",
    hint: "Days between surveys of this topic.",
    min: 1,
  },
  {
    key: "windowDays",
    label: "Look back",
    hint: "Days each survey reaches back over. At least the cadence.",
    min: 1,
  },
];

const CAP_ROWS: SettingRow[] = [
  {
    key: "maxStandingQueries",
    label: "Standing searches",
    hint: "How many saved searches this topic may hold.",
    min: 0,
  },
  {
    key: "maxProbesPerRun",
    label: "Probe searches per survey",
    hint: "Extra one-off searches a survey may try.",
    min: 0,
  },
  {
    key: "maxGroupsPerRun",
    label: "Story groups per survey",
    hint: "How many stories one survey may report on.",
    min: 1,
  },
  {
    key: "maxVideosPerGroup",
    label: "Videos per group",
    hint: "How many videos one story may draw on.",
    min: 1,
  },
  {
    key: "maxChannelVideosPerRun",
    label: "Channel videos per survey",
    hint: "How many videos a survey may take from trusted channels.",
    min: 1,
  },
];

export function TopicSettingsCard({ topicId, settings, editable }: TopicSettingsCardProps) {
  const [fields, setFields] = useState<TopicSettingsFields>(toTopicSettingsFields(settings));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const setField = (key: keyof TopicSettings, value: string) => {
    setFields((previous) => ({ ...previous, [key]: value }));
    setSaved(false);
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;

    const parsed = parseTopicSettings(fields);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setIsSaving(true);
    setError(null);
    const result = await updateTopicSettingsAction(topicId, parsed.value);
    setIsSaving(false);
    if (result.ok) {
      setSaved(true);
      return;
    }
    setError(result.error);
  };

  const renderRow = (row: SettingRow) => (
    <div key={row.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Label htmlFor={`topic-setting-${row.key}`} className="w-56 shrink-0">
        {row.label}
      </Label>
      <Input
        id={`topic-setting-${row.key}`}
        type="number"
        min={row.min}
        step={1}
        inputMode="numeric"
        className="w-24"
        value={fields[row.key]}
        onChange={(event) => setField(row.key, event.target.value)}
        disabled={!editable}
      />
      <span className="text-xs text-[var(--color-text-tertiary)]">{row.hint}</span>
    </div>
  );

  return (
    <TopicSection
      title="Schedule and limits"
      description="How often this topic is surveyed, how far back it looks, and the ceilings one survey works under."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">{SCHEDULE_ROWS.map(renderRow)}</div>
        <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
          {CAP_ROWS.map(renderRow)}
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}

        {editable && (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving
                </>
              ) : (
                "Save settings"
              )}
            </Button>
            {saved && <span className="text-sm text-[var(--color-text-secondary)]">Saved</span>}
          </div>
        )}
      </form>
    </TopicSection>
  );
}
