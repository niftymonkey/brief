"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TopicSection } from "@/components/topics/topic-section";
import { setTopicActiveAction, updateTopicIdentityAction } from "@/app/(app)/topics/actions";

interface TopicIdentityCardProps {
  topicId: string;
  name: string;
  slug: string;
  interests: string | null;
  isActive: boolean;
  editable: boolean;
}

export function TopicIdentityCard({
  topicId,
  name,
  slug,
  interests,
  isActive,
  editable,
}: TopicIdentityCardProps) {
  const [nameField, setNameField] = useState(name);
  const [interestsField, setInterestsField] = useState(interests ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingActive, setIsTogglingActive] = useState(false);

  const dirty = nameField !== name || interestsField !== (interests ?? "");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nameField.trim() || isSaving) return;

    setIsSaving(true);
    setError(null);
    setSaved(false);
    const result = await updateTopicIdentityAction(topicId, {
      name: nameField,
      interests: interestsField,
    });
    setIsSaving(false);
    if (result.ok) {
      setSaved(true);
      return;
    }
    setError(result.error);
  };

  const handleToggleActive = async () => {
    setIsTogglingActive(true);
    setError(null);
    const result = await setTopicActiveAction(topicId, !isActive);
    setIsTogglingActive(false);
    if (!result.ok) {
      setError(result.error);
    }
  };

  return (
    <TopicSection
      title="Identity"
      description="What this topic is called and what you care about in it."
      action={
        editable ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleToggleActive}
            disabled={isTogglingActive}
          >
            {isTogglingActive ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isActive ? (
              "Pause surveys"
            ) : (
              "Resume surveys"
            )}
          </Button>
        ) : undefined
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="topic-identity-name">Name</Label>
          <Input
            id="topic-identity-name"
            value={nameField}
            onChange={(event) => {
              setNameField(event.target.value);
              setSaved(false);
            }}
            maxLength={200}
            disabled={!editable}
            required
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">Address</p>
          <p className="font-mono text-sm text-[var(--color-text-secondary)]">/topics/{slug}</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            Set when the topic was created and left alone by a rename, so a link you have
            saved keeps working.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="topic-identity-interests">What you care about</Label>
          <Textarea
            id="topic-identity-interests"
            value={interestsField}
            onChange={(event) => {
              setInterestsField(event.target.value);
              setSaved(false);
            }}
            rows={4}
            disabled={!editable}
            placeholder="Async runtimes, compiler releases, and anything about the borrow checker."
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}

        {editable && (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!dirty || !nameField.trim() || isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving
                </>
              ) : (
                "Save"
              )}
            </Button>
            {saved && <span className="text-sm text-[var(--color-text-secondary)]">Saved</span>}
          </div>
        )}
      </form>
    </TopicSection>
  );
}
