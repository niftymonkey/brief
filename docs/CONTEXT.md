# Brief

> Read this to understand what Brief is for before helping shape it. It is about intent, not implementation. Architecture lives in `docs/architecture/`.

## What it is

Brief turns a YouTube video into a structured, timestamped brief, and keeps every brief you make in a searchable personal library. Web app, CLI, and a Chrome extension. You hand it a link; it hands back enough to know what to do about the video.

YouTube only, and permanently so. Almost every hard decision here is YouTube-shaped. That is a commitment, not a stage on the way to general video.

## What it's for

Long-form video hides whether it is worth watching behind the watching. Titles are marketing and transcripts are too long to triage with, so you either spend the forty minutes finding out or you skip things you would have valued. Brief answers that question before you pay for it: worth it, not now, or here is the one section that matters.

Then it became a second thing. Once there were hundreds of briefs, the library turned into memory. You half-remember an idea and have lost the word for it, so you search a fragment, land on something from a year ago, and the term comes back. That is not deciding whether to watch anything. It is reference, and it is why search exists and why search has to be fast. A slow search sends you to Google instead, and then the library is just storage.

Those two uses are related but neither reduces to the other. Most work serves one or the other.

## Center of gravity

Nearly everything Brief does points at helping someone decide what deserves their attention. A whole video, a section of one, something they might want next year, something they want to hand to another person. That is the throughline, and it is why the pieces fit together rather than sprawl.

It is a center of gravity, not a test. Dark mode, working on a phone, tags, not losing your library: these sit off the line and belong anyway, because they are what any decent application owes the person using it. Do not use this document to argue against work simply because it does not serve triage. It describes what Brief is about. It does not adjudicate what Brief may contain.

## What's unsettled

Real tensions, deliberately unresolved. Do not quietly settle them.

**Triage leaves residue.** Finding out a video is worthless requires making a brief, and making one stores it forever. The tool that protects attention manufactures clutter by working correctly. Nothing captures the verdict either, so the library cannot tell a keeper from a skip. Delete, archive, annotate, decay: all considered, none chosen.

**Relevance decays, value does not.** Most of an aging technical library is superseded, and still worth keeping, because ideas outlast the tools they arrived in. Deleting to fix relevance destroys the good part. It is also uneven inside a single brief: names and versions rot while the concept underneath does not, so one staleness badge on a whole brief would mislead.

**Nothing knows what superseded what.** The useful fact about an old brief is whether something newer replaced it, which requires knowing about videos that were never briefed. For now the person bridges it themselves, taking the recovered term to a current source. That is the accepted answer, not a gap awaiting automation.

## Decisions versus leftovers

Some of today's behavior is chosen and some is just the order things got built. Do not treat the second kind as sacred.

Chosen: YouTube only, transcript first, briefs always generated server-side, failures degrade instead of aborting, video bytes are transient, no stored stills (copyright), search is fast, public videos only.

Leftovers, open to change: every brief kept forever with equal standing, briefs carrying no verdict or state, access by allowlist, keys hosted and paid centrally, the schema still saying `digests`.

The allowlist is worth naming plainly: it exists because the maintainer pays for the API keys, not because Brief is meant to stay private. Public access is the intent, most likely metered and then bring-your-own-key.
