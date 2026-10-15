# Design system findings (2026-10-14)

Found while generating DESIGN.md. Not fixed; each needs a decision on whether and when.

1. **Invisible keyboard selection.** `--color-accent` (terracotta) is never mapped in `@theme inline`, and shadcn's `--accent` is near-neutral, so `bg-accent` highlights do nothing. Dropdown items (`focus:bg-accent`) and command-list items (`data-[selected=true]:bg-accent`) show no highlight in either theme; keyboard selection in the tag filter and user menu is effectively invisible. Stock outline and ghost buttons get no hover fill in light mode.
2. **Contrast below WCAG AA** (approximate, from compiled sRGB): white on dark-mode terracotta (filter chips, "Play from the top", "Get Started") about 3.5:1; dark-mode tertiary text about 3.3:1; light-mode playing gold on the shelf ("now playing", lit ordinal) about 3.1:1; light-mode `[tangent]` amber about 1.9:1; light-mode terracotta back links about 4.3:1.
3. **Two parallel color systems.** App code uses `[var(--color-*)]`; shadcn primitives use semantic utilities. Some pairs drift (dark `--secondary`/`--muted` 22% vs `--color-bg-tertiary` 18%).
4. **No terracotta Button variant.** About 15 call sites override the default with `bg-[var(--color-accent)] text-white`; New Brief inverts the rest/hover pair.
5. **Hardcoded colors.** `text-white` on terracotta fills; Tailwind `red-500`/`red-400` for errors in about 25 places beside shadcn `--destructive`; `text-green-500` in the progress modal; TagBadge carries about 20 hardcoded `oklch(... 25)` values.
6. **Two shadow systems.** Warm `--shadow-sm/md/lg` tokens exist but only `--shadow-md` is used; everything else uses Tailwind's neutral-black shadows.
7. **Radius inversion.** `rounded-3xl` resolves to 22px, smaller than `rounded-2xl` (24px), so the collection section's corners shrink at `sm`.
8. **Stale comments in globals.css.** Dark mode is labelled "warmer charcoal" but is hue 270 (cool); a "Focus styles - temporarily disabled for testing" comment has nothing under it.
9. **Smaller drifts.** Meta separators differ (brief "•", collection "/"); back links differ in size between briefs and collections; the header wordmark is lucide's `Youtube` icon (against the "not a YouTube clone" anti-reference); site metadata says "AI-powered summaries" (against the "powered by AI" anti-reference).
