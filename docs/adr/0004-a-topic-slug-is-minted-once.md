# A Topic's slug is minted once and never rewritten

A Topic's URL is `/topics/<slug>`. The slug is derived from the name when the Topic is created and is never written again, so renaming a Topic does not move its page. Every link the owner has saved or pasted into a note keeps working, and there is no redirect table, no history of old slugs, and no rule about how long a retired slug stays reserved. Lookup is owner-scoped, so a slug addresses a page only inside the account that minted it. `slug` is absent from `UpdateTopicInput` and from the update statement, so a rename can never collide; creation still probes the per-user unique index and steps through numeric suffixes until one is free.

The cost is a slug that can drift from the name: rename "AI engineering" to "Agent tooling" and the URL still says `ai-engineering`. That is accepted. A Topic is a long-lived thing a person returns to for months, and the same longevity that makes renaming likely is what makes a broken link expensive.

## Considered options

Re-slugging on rename with a redirect table was rejected. It buys a tidier URL and costs a second table, a lookup on every miss, a retention rule for old slugs, and a collision path between a retired slug and a new Topic's fresh one. None of that is worth a cosmetic match.

Keying the page on the Topic's id, as Collections does at `/collections/[id]`, was rejected for a different reason. It makes the URL stable by making it opaque, and a Topic is a subject a person names, so the name belongs in the URL where it is readable and typable.

Mapping a slug collision to a typed error, leaving slug editable, was rejected during review of PR #134. It preserves a capability nothing asks for and leaves the link-breaking path open.
