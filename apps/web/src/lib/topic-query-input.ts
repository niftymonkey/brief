export type ParsedTopicQuery = { ok: true; value: string } | { ok: false; error: string };

/**
 * The checks a standing search passes before it reaches a Topic, whether it is
 * being added or being edited. Both paths share them so an edit down to nothing
 * is refused rather than read as a deletion.
 */
export function parseTopicQuery(raw: string): ParsedTopicQuery {
  const query = raw.trim();
  if (query === "") {
    return { ok: false, error: "Type the search you want run." };
  }
  return { ok: true, value: query };
}
