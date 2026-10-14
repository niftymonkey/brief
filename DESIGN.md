---
name: Brief
description: A YouTube video turned into a timestamped brief, and a handful of clips turned into a collection worth watching through.
colors:
  terracotta: "oklch(58% 0.19 25)"
  terracotta-deep: "oklch(52% 0.21 25)"
  terracotta-ember: "oklch(46% 0.22 25)"
  terracotta-blush: "oklch(93% 0.04 25)"
  playing-gold: "oklch(62% 0.13 75)"
  tangent-amber: "oklch(75% 0.15 85)"
  linen: "oklch(97% 0.007 55)"
  linen-paper: "oklch(98% 0.005 55)"
  linen-shelf: "oklch(94% 0.012 55)"
  linen-well: "oklch(90.5% 0.015 55)"
  linen-seam: "oklch(88% 0.012 55)"
  linen-seam-strong: "oklch(80% 0.018 55)"
  walnut-ink: "oklch(18% 0.02 40)"
  walnut-button: "oklch(22% 0.02 40)"
  umber: "oklch(38% 0.02 40)"
  dust: "oklch(52% 0.015 40)"
  terracotta-night: "oklch(65% 0.16 25)"
  terracotta-night-bright: "oklch(72% 0.18 25)"
  terracotta-night-deep: "oklch(55% 0.18 25)"
  terracotta-night-wash: "oklch(22% 0.06 25)"
  playing-gold-night: "oklch(80% 0.13 80)"
  slate-night: "oklch(12% 0.008 270)"
  slate-shelf: "oklch(14% 0.01 270)"
  slate-well: "oklch(18% 0.012 270)"
  slate-raise: "oklch(22% 0.012 270)"
  slate-seam: "oklch(22% 0.018 270)"
  slate-seam-strong: "oklch(30% 0.022 270)"
  frost: "oklch(96% 0.004 270)"
  fog: "oklch(65% 0.006 270)"
  haze: "oklch(50% 0.005 270)"
  on-terracotta: "oklch(100% 0 0)"
  video-black: "oklch(0% 0 0)"
  error-red: "oklch(63.7% 0.237 25.331)"
  destructive: "oklch(57.7% 0.245 27.325)"
  destructive-night: "oklch(70.4% 0.191 22.216)"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "4.5rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  body-reading:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.625
  body:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-note:
    fontFamily: "Source Sans 3, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
  ordinal:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "tnum"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  2xl: "24px"
  3xl: "22px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "3.5": "14px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "10": "40px"
  "12": "48px"
components:
  button-cta:
    backgroundColor: "{colors.terracotta}"
    textColor: "{colors.on-terracotta}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-cta-hover:
    backgroundColor: "{colors.terracotta-deep}"
  button-ink:
    backgroundColor: "{colors.walnut-button}"
    textColor: "{colors.linen}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-quiet-icon:
    backgroundColor: "{colors.linen}"
    textColor: "{colors.umber}"
    rounded: "{rounded.md}"
    size: "32px"
  button-quiet-icon-hover:
    backgroundColor: "{colors.linen-well}"
    textColor: "{colors.terracotta}"
  button-play-hero:
    backgroundColor: "{colors.terracotta}"
    textColor: "{colors.on-terracotta}"
    rounded: "{rounded.full}"
    size: "56px"
  button-play-hero-playing:
    size: "32px"
  input-search:
    backgroundColor: "{colors.linen-shelf}"
    textColor: "{colors.walnut-ink}"
    rounded: "{rounded.lg}"
    padding: "10px 16px 10px 40px"
    typography: "{typography.body}"
  chip-filter:
    backgroundColor: "{colors.linen-well}"
    textColor: "{colors.umber}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  chip-filter-active:
    backgroundColor: "{colors.terracotta}"
    textColor: "{colors.on-terracotta}"
  tag-badge:
    backgroundColor: "oklch(94% 0.04 25)"
    textColor: "oklch(42% 0.12 25)"
    rounded: "{rounded.full}"
    padding: "2px 10px"
    height: "24px"
  timestamp-chip:
    backgroundColor: "{colors.terracotta-blush}"
    textColor: "{colors.terracotta}"
    rounded: "{rounded.md}"
    padding: "2px 8px"
    typography: "{typography.label}"
  brief-card:
    backgroundColor: "{colors.linen-shelf}"
    textColor: "{colors.walnut-ink}"
    rounded: "{rounded.xl}"
    padding: "16px"
  collection-section:
    backgroundColor: "{colors.linen-shelf}"
    textColor: "{colors.walnut-ink}"
    rounded: "{rounded.2xl}"
    padding: "24px"
  rail-marker:
    backgroundColor: "{colors.linen-shelf}"
    textColor: "{colors.dust}"
    rounded: "{rounded.full}"
    size: "28px"
    typography: "{typography.ordinal}"
  rail-marker-playing:
    backgroundColor: "{colors.playing-gold}"
    textColor: "{colors.linen-shelf}"
  rail-segment:
    backgroundColor: "{colors.linen-seam}"
    width: "1px"
  rail-segment-playing:
    backgroundColor: "{colors.playing-gold}"
  player-frame:
    backgroundColor: "{colors.video-black}"
    rounded: "{rounded.xl}"
  nav-link:
    textColor: "{colors.umber}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
  nav-link-active:
    backgroundColor: "{colors.linen-well}"
    textColor: "{colors.walnut-ink}"
---

# Design System: Brief

## 1. Overview

**Creative North Star: "The Liner Notes"**

Brief is the sleeve around the record, never the record. A video is the music; the brief, the collection header, the numbered entries and their mono timings are the liner notes printed around it: set in careful type, ruled with hairlines, numbered like a track listing, and quiet enough that the eye goes straight to the clip. Every surface answers "worth it?" first and then rewards whoever keeps reading, the way good liner notes reward a second listen.

The system is restrained. Neutrals carry almost all of every screen, one terracotta accent marks the single action or link that matters, and a warm gold exists for exactly one meaning: this is the entry playing now. Depth comes from tonal shelves and 1px seams, not shadows. Density is moderate and editorial: generous line height for reading, compact mono for facts. Motion is a slow, confident ease (`cubic-bezier(0.32, 0.72, 0, 1)`) that transforms things in place rather than adding things to the page.

Two themes, deliberately not mirror images. Light is **Warm Linen**: paper-toned neutrals on hue 55 with walnut ink on hue 40, for a recipient opening a shared collection at a desk in daylight. Dark is **Cool Slate**: near-black neutrals on hue 270, for Mark triaging a forty-minute video in the evening, which is why dark is the default theme (system preference is honored). The terracotta and gold are shared across both; only their lightness shifts.

The system rejects, by name, everything in PRODUCT.md's anti-references: a YouTube clone ("red-and-white video-site chrome, thumbnail walls, recommendation-feed energy"), generic SaaS ("cream backgrounds, gradient buttons, hero metrics, identical card grids"), a dense admin panel ("gray tables, tiny type, everything boxed in"), and AI-product gloss ("purple gradients, sparkle icons, 'powered by AI' announcements").

Layout lives in a single reading column. A brief is a 48rem article; a collection is a 50rem article; library and collections indexes widen to 64rem grids. Page gutters are 16px at every width. A sticky 56px header (and on the library a sticky toolbar under it) sits on a 95% opaque page color with a backdrop blur, the only blur in the system, used so content scrolling under it stays legible rather than for gloss. Breakpoints follow Tailwind (`sm` 640px, `md` 768px, `xl` 1280px) plus content-driven steps for the toolbar (540px, 780px, 900px) and header labels (340px, 400px, 520px).

**The Clip Is the Main Event Rule.** Nothing on a collection or brief page may compete with the video frame for attention: no decorative imagery, no accent-filled panels, no motion near the frame while it plays.

**Key Characteristics:**
- Restrained palette: tinted neutrals, one terracotta accent, one gold state color.
- Three type voices: Plus Jakarta Sans names things, Source Sans 3 is read, JetBrains Mono states facts.
- Flat tonal shelves (page, shelf, well) separated by 1px seams.
- Transform in place: playing folds the header down instead of appending a player.
- Warm Linen light theme, Cool Slate dark theme, dark by default.
- Phone is a first-class layout, not a squeezed desktop.

## 2. Colors: The Linen and Ember Palette

Restrained: neutrals tinted toward the brand hue carry the page, terracotta is the only accent, and gold is a state, not a decoration. Values are OKLCH and canonical, light theme first and its dark counterpart beside it.

### Primary
- **Terracotta** (oklch(58% 0.19 25) light, oklch(65% 0.16 25) dark): the one accent. Fills the hero Play control, the "Play from the top" and "Get Started" calls to action, active filter chips, the avatar fallback, and the copy-link button. As text it colors timestamps, back links, related-link titles, and the hover state of titles and quiet icon buttons. It is also the focus ring color.
- **Terracotta Deep** (oklch(52% 0.21 25) light, oklch(72% 0.18 25) dark): hover for terracotta fills and terracotta text. Light theme hovers darker, dark theme hovers brighter; both move away from the background.
- **Terracotta Ember** (oklch(46% 0.22 25) light, oklch(55% 0.18 25) dark): the resting fill of the header's New Brief button, which hovers up to Terracotta. Used nowhere else.
- **Terracotta Blush** (oklch(93% 0.04 25) light, oklch(22% 0.06 25) dark): the background wash behind timestamp chips and the text selection color.

### Secondary
- **Playing Gold** (oklch(62% 0.13 75) light, oklch(80% 0.13 80) dark): marks the entry a sitting is on, and nothing else. It lights the rail segment below the playing marker, fills that marker, and colors the "now playing" mono label. It is gold rather than terracotta so "playing" reads as its own state instead of as another button.

### Tertiary
- **Tangent Amber** (oklch(75% 0.15 85), both themes): the `[tangent]` prefix on key points the brief marks as digressions. Its only job is to say "off the main line".
- **Error Red** (oklch(63.7% 0.237 25.331), both themes): inline error copy (with `role="alert"`), the delete icon button's hover, and the failed-playback list. It is Tailwind's red-500 used directly rather than a project token.
- **Destructive** (oklch(57.7% 0.245 27.325) light, oklch(70.4% 0.191 22.216) dark): the shadcn destructive token, filling the confirm button inside delete dialogs and the `aria-invalid` border and ring.
- **On Terracotta** (oklch(100% 0 0), both themes): label and icon color on every terracotta fill.

### Neutral
- **Linen / Slate Night** (oklch(97% 0.007 55) light, oklch(12% 0.008 270) dark): the page ground and header/toolbar ground.
- **Linen Paper** (oklch(98% 0.005 55) light, oklch(14% 0.01 270) dark): shadcn card and popover surfaces, a hair lighter than the page.
- **Linen Shelf / Slate Shelf** (oklch(94% 0.012 55) light, oklch(14% 0.01 270) dark): the first raised tone. Brief cards, collection cards, the collection section, the closing block, chapter rows, the sidebar, the search field.
- **Linen Well / Slate Well** (oklch(90.5% 0.015 55) light, oklch(18% 0.012 270) dark): the second tone. Hover fill for rows, nav links and quiet buttons; resting fill for filter chips; thumbnail placeholders; the active sidebar link.
- **Slate Raise** (oklch(22% 0.012 270), dark only): shadcn `secondary` and `muted` in dark mode, one step above Slate Well.
- **Linen Seam / Slate Seam** (oklch(88% 0.012 55) light, oklch(22% 0.018 270) dark): every 1px border and divider, the resting rail, input strokes.
- **Linen Seam Strong / Slate Seam Strong** (oklch(80% 0.018 55) light, oklch(30% 0.022 270) dark): hover border on cards and the hover fill of unselected chips; the scrollbar thumb.
- **Walnut Ink / Frost** (oklch(18% 0.02 40) light, oklch(96% 0.004 270) dark): primary text and headings.
- **Walnut Button** (oklch(22% 0.02 40) light, oklch(96% 0.004 270) dark): the fill of the default shadcn button, the quiet confirm action ("Save note", "Resume").
- **Umber / Fog** (oklch(38% 0.02 40) light, oklch(65% 0.006 270) dark): secondary text: ledes, notes, card meta, resting icon buttons.
- **Dust / Haze** (oklch(52% 0.015 40) light, oklch(50% 0.005 270) dark): tertiary text: mono metadata, placeholders, empty states, resting rail ordinals.
- **Video Black** (oklch(0% 0 0), both themes): the letterbox behind every video frame and the full-screen backdrop. The only pure black allowed, because it must match the YouTube player's own frame.

### Named Rules
**The One Ember Rule.** Terracotta covers no more than about 10% of any screen. On a given view exactly one control is filled with it (the Play control on a collection, New Brief in the header); everything else uses it only as text or on hover. A second filled terracotta button on the same view is prohibited.

**The Gold Means Now Rule.** Playing Gold appears only on the entry being played. It is never a button, a badge, a highlight, or a decoration, and it is never used when nothing is playing.

**The Paper, Not Cream Rule.** Light neutrals stay at chroma 0.015 or below on hue 55 so the page reads as linen paper, not as SaaS cream. Dark neutrals stay at chroma 0.022 or below on hue 270. Raising neutral chroma to "warm it up" is prohibited.

## 3. Typography

**Display Font:** Plus Jakarta Sans (with ui-sans-serif, system-ui)
**Body Font:** Source Sans 3 (with ui-sans-serif, system-ui)
**Label/Mono Font:** JetBrains Mono (with ui-monospace)

**Character:** A geometric-humanist display face with tight tracking gives names and titles a confident, made-by-a-person edge; Source Sans 3 is a calm, open reading face that holds long briefs; JetBrains Mono turns every fact (a time, a count, an ordinal, a URL) into something that reads like a track listing. All three load through `next/font` as `--font-plus-jakarta`, `--font-source-sans` and `--font-jetbrains`, and are exposed as `font-heading`, `font-sans` and `font-mono`.

### Hierarchy
- **Display** (600, 3rem phone, 3.75rem `md`, 4.5rem `lg`, line height 1, -0.025em): the signed-out landing headline only, with one word in terracotta.
- **Headline** (600, 1.625rem phone and 2rem `sm` for a collection title; 1.25rem to 1.5rem for a brief title; line height 1.15, -0.025em): the page's one `h1`. A collection title shrinks to 1.125rem phone and 1.0625rem `sm` while a run plays, animated on the header's ease.
- **Title** (600, 1.125rem section heading; 1rem phone and 1.0625rem `sm` for an entry title; line height 1.35, -0.025em): section headings such as "The Gist" and "Chapters" sit on a 1px seam rule; collection entry titles sit level with their rail marker.
- **Body Reading** (400, 1.125rem, line height 1.625): the brief's gist, chapter titles (set at weight 300) and key points. The article column caps this near 75ch.
- **Body** (400, 1rem, line height 1.5): default UI copy, collection ledes (line height 1.6, capped at 36rem), card titles at weight 500.
- **Body Note** (400, 0.875rem phone and 0.9375rem `sm`, line height 1.55): collection entry notes and the player's caption under the frame, always in Umber/Fog.
- **Label** (400, 0.75rem mono): bylines, entry counts and runtimes separated by a dimmed `/`, resting entry offsets ("at 4:10 / 2:35"), the position counter while playing, timestamps (0.875rem in brief chapters), ranges.
- **Ordinal** (400, 0.6875rem mono, tabular numerals, zero-padded "01"): rail markers only.

### Named Rules
**The Three Voices Rule.** Plus Jakarta names things, Source Sans is read, JetBrains Mono states facts. A heading in mono, a number in the heading face, or a paragraph in mono is prohibited. Every global `h1` to `h6` gets the heading face at 600 and -0.025em automatically; do not restyle them back to the body face.

**The Facts in Mono Rule.** Anything a viewer could copy as data (a timestamp, a range, a runtime, an entry count, a share URL, a video id placeholder) is set in JetBrains Mono at 0.75rem or smaller, in Dust/Haze unless it is an active link.

## 4. Elevation

Brief is flat by default and layers by tone. The page ground, the shelf, and the well are three steps of the same neutral, and every container is outlined by a 1px seam; that is what separates surfaces. Shadows appear in three situations only: a card lifting on hover, the floating hero Play control, and overlays (dialogs, popovers, the dragged entry). The project defines warm, ink-tinted shadows as tokens (`--shadow-sm`, `--shadow-md`, `--shadow-lg`, tinted with `oklch(25% 0.015 40)` in light and plain black at higher opacity in dark); Tailwind's own `shadow-xs` to `shadow-lg` are also in use on shadcn primitives and some app surfaces.

### Shadow Vocabulary
- **Card lift** (`box-shadow: var(--shadow-md)`, which is `0 4px 12px oklch(25% 0.015 40 / 0.09)` in light, `0 4px 12px oklch(0% 0 0 / 0.35)` in dark): brief and collection cards on hover, together with the border stepping to Seam Strong.
- **Resting hairline** (Tailwind `shadow-sm` and `shadow-xs`): the collection section at rest; outline buttons and inputs.
- **Floating control** (Tailwind `shadow-md`): the circular hero Play control, and the entry being dragged.
- **Overlay** (Tailwind `shadow-lg` and `shadow-md`): dialogs and popovers, over a `black / 50%` scrim for dialogs and sheets.

### Named Rules
**The Flat Shelf Rule.** Surfaces are flat at rest and separated by tone plus a 1px seam. A shadow is a response to state (hover, drag, overlay) or marks the single floating control. If two adjacent resting surfaces both carry shadows, one of them is wrong.

## 5. Components

### Buttons
Quiet, precise, and mostly outlined. The weight of a screen sits in one filled control.
- **Shape:** gently rounded (8px) for rectangular buttons; fully round for the hero Play control and filter chips.
- **Call to action (terracotta):** Terracotta fill, white label, 36px tall, 16px horizontal padding, 14px medium label with a 16px leading icon. Hover to Terracotta Deep. There is no `accent` variant on the shared Button; each call to action overrides the default variant's colors in place.
- **Default (ink):** Walnut Button fill with Linen text (inverted to Frost fill in dark). For quiet confirmations inside a flow: "Save note", "Resume". Hover drops the fill to 90%.
- **Quiet icon (outline):** 32px square (34px phone and 36px `sm` inside the collection header cluster), page-ground fill, 1px seam, Umber icon. Hover shifts the icon and border to terracotta (border at 50%) and fills with Well. Destructive icon buttons hover to red instead of terracotta.
- **Hero Play:** a 56px terracotta circle with a filled 24px play glyph nudged 2px right for optical centering, `shadow-md`. When a run starts it shrinks to a 32px Stop control on the header's ease (340ms).
- **Destructive confirm:** shadcn destructive red fill with white text, used only inside confirmation dialogs.
- **Focus:** a 3px ring of terracotta at 50% plus a terracotta border, on every button and input.

### Chips
- **Filter chip:** fully round, 4px by 10px, 14px label. Resting on Well with Umber text, hovering to Seam Strong with Ink text; selected fills with terracotta, white text, a trailing 12px X, and the usage count dimmed to white at 50%. Transitions over 150ms.
- **Tag badge:** fully round, 24px (20px small) tall, a pale terracotta-tinted fill with a deeper terracotta label and a faint terracotta border. Active tags step darker in light and lighter in dark. Clickable tags carry a tooltip explaining the filter action.
- **Timestamp chip:** mono 14px in terracotta on a Blush wash, 8px radius; a 12px play glyph fades in on hover.

### Cards / Containers
- **Corner Style:** brief and collection cards 16px; the collection section and its closing block 24px (the collection section's `sm` step, `rounded-3xl`, resolves to 22px); thumbnails 8px to 12px; chapter rows 12px.
- **Background:** Shelf on the page ground; Well for placeholders inside them.
- **Shadow Strategy:** flat at rest; card lift on hover (see Elevation).
- **Border:** always 1px Seam; Seam Strong on hover.
- **Internal Padding:** 16px for cards; 16px phone and 24px `sm` for the collection section; 20px for the closing block.
- **Brief card:** 16:9 thumbnail on top that scales to 105% on hover over 300ms, a two-line 500-weight title that turns terracotta on hover, up to three tag badges plus a "+N", and a seam-ruled footer with channel and date.
- Cards appear only in the library and collections index grids. Inside a brief or a collection, content sits on rules, not in boxes.

### Inputs / Fields
- **Style:** 1px Seam stroke, transparent fill (Input at 30% in dark), 8px radius, 36px tall, 16px text on phone and 14px from `md`. The library search is the exception: 12px radius, Shelf fill, a 20px Dust search glyph inset 12px, 16px text, and a round clear button that appears once there is a value.
- **Focus:** a 3px terracotta ring at 50%.
- **Error / Disabled:** `aria-invalid` turns the border destructive red with a faint red ring; disabled drops to 50% opacity. Inline error copy is 14px red text with `role="alert"`.

### Navigation
- **Header:** sticky, 56px, page ground at 95% with backdrop blur, bottom seam. A wordmark that turns terracotta on hover, then Collections and Topics links (14px, Umber, Shelf fill on hover, labels collapse to icons below 520px), and on the right New Brief, the user menu and the theme toggle.
- **Library sidebar:** desktop only, resizable, Shelf fill with a right seam; 14px links with 16px icons, Umber at rest and Ink on a Well fill when active or hovered; collections nested at a 32px indent with their item counts in Dust. Opens and closes over 200ms ease-out, and the resize handle appears as a 4px to 6px Seam Strong bar on hover.
- **Library toolbar:** sticky under the header at 56px, same translucent ground. One line from 900px; between 540px and 780px tag and date filters collapse to round icon buttons; below 540px the filters take their own full-width row.
- **Back links:** terracotta text with an arrow, hovering to Terracotta Deep.

### Collection Rail (signature)
The rail is the collection's track listing: a thin line running down the left column through numbered ordinal markers, one per entry.
- **Markers:** 28px circles with a 1px Seam border on Shelf, holding a zero-padded mono ordinal in Dust. Each marker sits in a 36px band centred on its entry's title and controls, so the rail breaks level with the row it belongs to.
- **Segments:** each row owns the 1px segment below its own marker, running down to where the next marker starts; the last row owns none, which is what ends the line. Resting segments are Seam.
- **Playing:** the playing entry's marker fills with Playing Gold (ordinal turns Shelf), its segment below lights gold, the next marker stays unlit, and the resting "at 4:10 / 2:35" label is replaced by a gold mono "now playing". The row carries `aria-current`.
- **Motion:** the playing state cross-fades. Markers and segments transition color over 300ms; nothing travels down the rail.
- **Phone:** below 640px the ordinal column is dropped to give the title a line, and the playing entry gets a 2px rounded gold bar 8px outside its left edge instead.
- **Thumbnail:** a fixed slot (76px phone, 104px `sm`) floated right of the note, so a 9:16 and a 16:9 still leave the note wrapping at the same point. Vertical stills size from a capped height (56px phone, 76px `sm`) times their aspect ratio.

**The Cross-Fade Rule.** The playing state moves down the rail by color alone. Markers and segments cross-fade to and from Playing Gold over 300ms; a lit bar sliding, growing, or travelling between entries is prohibited.

### Collection Header and Player (signature)
- **Transform in place:** the collection is one 24px-radius Shelf section. Pressing Play does not append a player; the header folds down. The Play control shrinks to Stop, the title and lede shrink, the mono byline collapses and the mono position counter takes exactly its slot, and the player opens into the height the header gives up (opacity in and an 8px rise). All of it runs on `cubic-bezier(0.32, 0.72, 0, 1)` over 340ms by animating grid rows between `0fr` and `1fr`, and all of it is disabled under reduced motion.
- **Transport cluster:** while playing, Previous, Next and a full-screen toggle (Maximize / Minimize glyphs) join the header's icon cluster, separated from share and owner controls by a 1px by 24px seam divider that appears only when there is something on the far side.
- **Frame:** Video Black, 12px radius on phone and 16px from `sm`. From `sm` up the frame is always 16:9 at full column width. On a phone only, the frame takes the video's true shape: a vertical Short is drawn `min(70vh, 32rem)` tall with its width derived from the aspect ratio and centred, while a landscape video fills the width.
- **Full screen:** the same frame element restyles in place (fixed, inset 0, above everything) rather than moving, so the playing iframe never remounts. Inside it the video is drawn at its true shape as large as the screen allows. It uses the browser's full screen where offered and a page-drawn fill otherwise (iPhone), which locks page scroll and answers Escape. A 36px round exit control sits top-right inside safe-area insets: Video Black at 60% with a white 25% border, hovering to 80%. Focus moves to it on entry and returns to the header toggle on exit.
- **Caption:** under the frame, a fixed-height block (one title line plus two note lines) so skipping never reflows the entries below: the entry title at 500 weight, its mono range, and the note in Umber.
- **Closing block:** after the entries, a 24px-radius Shelf block with the total runtime as a title, one line of Umber copy, a terracotta "Play from the top" and an outline share button.

### Brief Chapters
- An accordion of Shelf rows (12px radius, 1px seam, 6px apart) under a seam-ruled "Chapters" heading with an expand-all text button. Each trigger shows a rotating 16px chevron, a light-weight 1.125rem chapter title, and a terracotta mono timestamp that seeks the embedded player. Key points are 1.125rem bulleted body; tangents are italic Dust with an amber `[tangent]` prefix.

## 6. Do's and Don'ts

### Do:
- **Do** keep terracotta to one filled control per view and use it otherwise only as text, hover, and the focus ring (The One Ember Rule).
- **Do** reserve Playing Gold (`oklch(62% 0.13 75)` light, `oklch(80% 0.13 80)` dark) for the entry being played, and move it by a 300ms color cross-fade, never by sliding.
- **Do** separate surfaces with the page, Shelf and Well tones plus a 1px Seam before reaching for any shadow.
- **Do** set every fact (time, range, count, ordinal, URL) in JetBrains Mono at 0.75rem or smaller.
- **Do** transform existing elements in place on state changes, using `cubic-bezier(0.32, 0.72, 0, 1)` and `motion-reduce:transition-none`.
- **Do** design the phone layout as its own composition: drop the ordinal column, let a vertical Short take its true shape at `min(70vh, 32rem)` tall, and stack the title under the controls.
- **Do** read colors from the `--color-*` tokens in both themes; check every new pairing in light and dark against WCAG 2.2 AA, as PRODUCT.md requires.
- **Do** give every icon-only control a `title` and an `aria-label`, and return focus to the control that opened a mode when it closes.

### Don't:
- **Don't** build anything that reads as a YouTube clone: no "red-and-white video-site chrome, thumbnail walls, recommendation-feed energy". Thumbnails stay subordinate to the note beside them.
- **Don't** drift toward generic SaaS: no "cream backgrounds, gradient buttons, hero metrics, identical card grids". Linen must stay at chroma 0.015 or below, and cards stay confined to the index grids.
- **Don't** become a dense admin panel: no "gray tables, tiny type, everything boxed in". No readable text below 0.75rem except ordinals and counts (0.625rem to 0.6875rem), and nothing inside a brief or collection gets boxed.
- **Don't** add AI-product gloss: no "purple gradients, sparkle icons, 'powered by AI' announcements".
- **Don't** use a second accent hue, or terracotta for state; "playing" is gold, errors are red, tangents are amber.
- **Don't** use `border-left` or `border-right` wider than 1px as a colored stripe on cards, rows or callouts; the phone's 2px playing bar is a detached mark, not a border.
- **Don't** use gradient text, glassmorphism, or blur anywhere except the sticky header and toolbar.
- **Don't** use pure `#000` or `#fff` outside the video frame, the full-screen exit control, and text on a terracotta fill.
- **Don't** animate layout properties for new work; the collection header's fold (its grid rows, the Play control's size, the title's font size) is the one sanctioned exception.
- **Don't** reach for a modal first: notes edit inline, the player opens inline, and sharing lives in a popover.
