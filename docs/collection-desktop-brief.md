# Collection page, desktop layout: design brief

Shaped with `impeccable shape` on 2026-10-14. Prototype that settled the layout: branch `prototype/collection-desktop-layout`, variant A ("Side by side").

## 1. Feature summary

On desktop the collection page uses the full viewport: the video on the left, the collection and its entries on the right, both in view at once. It serves the recipient of a shared link (usually at a desk, first visit, never seen Brief) and Mark on his own collection page while assembling and editing. Phones and tablets keep the layout already on `feat/vertical-shorts`.

## 2. Primary user action

Watch the collection through, in order, while always seeing where you are in it and what comes next.

## 3. Design direction

- **Color strategy:** Restrained, per DESIGN.md. Terracotta only for the one primary action (Play); gold only for "now playing" and only while playing.
- **Scene sentence:** someone a friend sent a link to, at a desk on a laptop or monitor in an ordinary lit room, giving the clips their full attention for ten minutes. Follows the app theme (light or dark); the stage behind the video is always the dark video field in both themes.
- **Anchors:** the YouTube theater-plus-playlist split without its chrome (see PRODUCT.md anti-references), Apple TV's "Up Next" column, a liner-notes booklet beside a record.
- **Probes:** skipped; the harness has no native image generation, and a working three-variant prototype answered the direction question instead.

## 4. Scope

Production quality on `feat/vertical-shorts`, with tests, then a PR. Desktop only: applies from the `lg` breakpoint (1024px) up. Below `lg`, render exactly what the branch renders today.

## 5. Layout strategy

- The page fills the viewport height under the app header; the page itself does not scroll at desktop sizes with typical content.
- **Left, the stage (dominant):** a dark field with the current entry's video centred at its true shape (`--frame-aspect`), as large as fits. Under it, the caption: the entry title, the gold "now playing / 01 of 05" line while playing, the entry's note, and the transport controls (Previous, Next, Stop, Full screen).
- **Right, the shelf (secondary):** a fixed-width column (about 27rem) holding the collection head (title, count and total runtime, share, owner actions) and the rail of entries, which scrolls independently when long. Rows show ordinal marker, title, channel and runtime, and a two-line clamp of the note.
- Reading order: stage first, then the shelf. The rail's lit segment ties the two together.

## 6. Key states

- **Not playing:** the stage shows the first entry's poster where the video will play, with a large Play and "Play all N". The current row gets a neutral marker ring, no gold. Pressing Play swaps the poster for the player in the same box; nothing moves.
- **Playing:** the YouTube player in the stage; the current row's rail segment and marker lit gold; Previous/Next disabled at the ends (as already built).
- **Run finished:** "Playback complete" in the stage area as today; Previous steps back to N-1.
- **Full screen:** the existing toggle and fallback, unchanged.
- **Single entry, empty collection, long collection (50+ entries), long titles, missing thumbnail, unknown frame shape (render 16:9):** all handled without layout breakage.
- **Owner page:** everything above plus the edit controls (drag grip, edit note, retry/generate note states, delete, add entry) in the shelf rows and head.
- **Shared page:** everything above plus the existing "Get Started" invitation, placed so it does not compete with the stage.

## 7. Interaction model

- Clicking a row jumps there (decided). While playing, the run moves to that entry and continues from it. While not playing, that entry's poster shows in the stage and Play starts the run from it.
- Play starts the run from the entry shown in the stage, which is the first entry unless a row was clicked.
- The existing playback machine, prev/skip, disabled-at-ends, and full screen behave exactly as today.
- The YouTube player must never remount across entries, idle to playing, or full screen (existing non-remount guarantee).
- Drag-to-reorder works in the shelf as it does in the list today, including keyboard reordering.
- Focus order: stage controls, then the shelf.

## 8. Content requirements

No new copy beyond what the page already has. Reuse "Play all N", "now playing", ordinal format "01 of 05", existing empty and error messages. Notes are capped at two sentences and 30 words by the summarizer, so the caption shows the full note and rows clamp to two lines.

## 9. Recommended references

`impeccable layout` (spatial rhythm of the two columns), `impeccable adapt` (the lg breakpoint and the tablet handoff), `impeccable harden` (edge states above), `impeccable audit` afterwards for WCAG AA.

## 10. Open questions

1. Where the shared page's "Get Started" invitation sits at desktop size (bottom of the shelf is the likely spot).
2. Poster resolution for vertical videos: `frame0.jpg` is low resolution at stage size; find a sharper source that does not 404 (`oar2.jpg` 404s on some videos).
3. Whether the shelf width should flex between 1024px and very wide screens, or stay fixed with the stage taking the rest.
