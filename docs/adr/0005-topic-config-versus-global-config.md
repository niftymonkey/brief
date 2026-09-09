# What a Topic configures, and what stays global

A Topic owns the settings that shape its own Runs and that a person would reasonably set differently per subject: its name, its interests text, its cadence, its rolling window, and its per-Run caps. Everything else lives in `packages/core` as one global value for the installation.

The line is drawn by what a setting protects. Transcript pacing, the hourly and daily ceilings, and the cool down are global because they protect one shared home IP across every Topic at once. A per-Topic value would let two Topics defeat the limit together while each looked well behaved, and the limit is the single hardest constraint the whole design runs against. Model choice is global because a refresh should be one diff in `packages/core/src/models.ts`, not a sweep across rows. Description retention at 90 days is a storage policy rather than a preference about a subject.

The three ask thresholds (drop a query after 6 runs with no unique catch, offer to add a channel at 3 briefs in 90 days) are global for now, and this is the one part of the line drawn for convenience rather than principle. Moving them onto the Topic is cheap and expected if the asks in #130 want per-Topic tuning.

## Considered options

Putting pacing on the Topic, so a person could run one subject harder, was rejected. It reads as flexibility and is actually a way to get the transcript source to rate-limit the whole installation, with the blame landing on whichever Run happened to be second.

A single global settings row covering everything, with no per-Topic values at all, was rejected because cadence and window are exactly what differs between a fast-moving subject and a slow one, and that difference is the point of having Topics rather than one feed.
