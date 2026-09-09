"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TopicSection } from "@/components/topics/topic-section";
import {
  addTopicQueryAction,
  removeTopicQueryAction,
  updateTopicQueryAction,
} from "@/app/(app)/topics/actions";
import { parseTopicQuery } from "@/lib/topic-query-input";
import type { TopicQuery } from "@/lib/topics";

interface TopicQueriesCardProps {
  topicId: string;
  queries: TopicQuery[];
  /** The Topic's own ceiling, which the add control reads before offering to add. */
  maxStandingQueries: number;
  editable: boolean;
}

export function TopicQueriesCard({
  topicId,
  queries,
  maxStandingQueries,
  editable,
}: TopicQueriesCardProps) {
  const [queryField, setQueryField] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editField, setEditField] = useState("");
  const [isEditSaving, setIsEditSaving] = useState(false);

  const atLimit = queries.length >= maxStandingQueries;

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isAdding || atLimit) return;

    setIsAdding(true);
    setError(null);
    const result = await addTopicQueryAction(topicId, queryField);
    setIsAdding(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setQueryField("");
  };

  const startEdit = (query: TopicQuery) => {
    setEditingId(query.id);
    setEditField(query.query);
    setError(null);
  };

  const handleEditSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (editingId === null || isEditSaving) return;

    const parsed = parseTopicQuery(editField);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setIsEditSaving(true);
    setError(null);
    const result = await updateTopicQueryAction(topicId, editingId, parsed.value);
    setIsEditSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditingId(null);
    setEditField("");
  };

  const handleRemove = async (queryId: string) => {
    setRemovingId(queryId);
    setError(null);
    const result = await removeTopicQueryAction(topicId, queryId);
    setRemovingId(null);
    if (!result.ok) {
      setError(result.error);
    }
  };

  return (
    <TopicSection
      title="Standing searches"
      description={`Searches run every survey. ${queries.length} of ${maxStandingQueries} used.`}
    >
      {queries.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No searches yet.
          {editable && " Add the phrases you would type into YouTube yourself."}
        </p>
      ) : (
        <ul className="rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
          {queries.map((query) =>
            editingId === query.id ? (
              <li key={query.id} className="px-3 py-2">
                <form onSubmit={handleEditSave} className="flex items-center gap-2">
                  <Input
                    value={editField}
                    onChange={(event) => {
                      setEditField(event.target.value);
                      setError(null);
                    }}
                    aria-label={`Edit ${query.query}`}
                    autoFocus
                  />
                  <Button type="submit" size="icon-sm" aria-label="Save search" disabled={isEditSaving}>
                    {isEditSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label="Cancel editing"
                    onClick={() => setEditingId(null)}
                    disabled={isEditSaving}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </form>
              </li>
            ) : (
              <li key={query.id} className="flex items-center gap-3 px-3 py-2">
                <span className="flex-1 min-w-0 text-sm text-[var(--color-text-primary)] break-words">
                  {query.query}
                </span>
                {editable && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Edit ${query.query}`}
                      onClick={() => startEdit(query)}
                      disabled={editingId !== null || removingId === query.id}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Remove ${query.query}`}
                      onClick={() => handleRemove(query.id)}
                      disabled={editingId !== null || removingId === query.id}
                    >
                      {removingId === query.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <X className="w-4 h-4" />
                      )}
                    </Button>
                  </>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-500">
          {error}
        </p>
      )}

      {editable && atLimit && (
        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
          This topic holds all {maxStandingQueries} searches it allows. Remove one, or raise the
          standing searches limit under Schedule and limits, to add another.
        </p>
      )}

      {editable && !atLimit && (
        <form onSubmit={handleAdd} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="topic-query">Add a search</Label>
            <Input
              id="topic-query"
              value={queryField}
              onChange={(event) => {
                setQueryField(event.target.value);
                setError(null);
              }}
              placeholder="e.g. rust async runtime"
            />
          </div>
          <Button type="submit" disabled={!queryField.trim() || isAdding}>
            {isAdding ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Adding
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Add
              </>
            )}
          </Button>
        </form>
      )}
    </TopicSection>
  );
}
