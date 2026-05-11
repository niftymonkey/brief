# YouTube ToS Research — Video Frames Feature

> **Status:** Research deliverable for [issue #84](https://github.com/niftymonkey/brief/issues/84). Input to the ship/no-ship decision on the video-frames feature ([`docs/video-frames-plan.md`](./video-frames-plan.md)).
> **Last updated:** 2026-05-11
> **Audience:** brief maintainers deciding whether and how to ship the per-digest "include video frames" feature, which downloads full video bytes via yt-dlp, extracts a small number of frames for vision-LLM analysis, then discards the bytes.

## Executive summary

**Verdict: yellow.** The feature can ship to an allowlisted dogfood cohort with specific mitigations; broad rollout to the public should wait until at least the technical mitigations below are in place, or a sanctioned vendor-mediated path replaces the direct yt-dlp pull.

The honest two-minute picture:

- **Today's transcript fetching is a different posture than tomorrow's frame extraction.** Captions are surfaced through documented, broadly-tolerated endpoints used by NotebookLM, Eightify, Glasp, "YouTube Summary with ChatGPT," and every transcript SaaS on the market. Downloading the muxed video stream is the operation YouTube's [main ToS](https://www.youtube.com/static?template=terms) (dated 15 December 2023) most explicitly prohibits outside "Download" button use, the Premium offline feature, or written permission. Brief moves from "in the broad gray bucket where everyone lives" to "doing the specific thing the ToS names."
- **The realistic legal downside is contract, not copyright.** [RIAA v. youtube-dl (2020)](https://github.blog/news-insights/policy-news-and-insights/standing-up-for-developers-youtube-dl-is-back/) settled the question of whether yt-dlp itself is a §1201 circumvention tool — GitHub reinstated the repo after the [EFF's letter](https://www.eff.org/files/2020/11/17/eff_letter_to_github_re_youtube-dl_11152020.pdf) established that the "rolling cipher" is not a TPM and that yt-dlp "stands in place of a Web browser." [Van Buren (2021)](https://www.supremecourt.gov/opinions/20pdf/19-783_k53l.pdf) and [hiQ v. LinkedIn (9th Cir. 2022)](https://cdn.ca9.uscourts.gov/datastore/opinions/2022/04/18/17-16783.pdf) narrowed CFAA so that scraping publicly viewable content is not federal hacking. The remaining real exposures are (a) breach of YouTube ToS as a contract claim, and (b) copyright infringement on the underlying videos — separate from any platform claim.
- **Enforcement, not litigation, is the live risk.** YouTube's actual response to scrapers is technical: the [August 2024 "Sign in to confirm you're not a bot" wave](https://github.com/yt-dlp/yt-dlp/issues/10128) blocked anonymous datacenter-IP access wholesale, and yt-dlp maintainers now treat cloud-host IPs as permanently flagged. The cost of getting blocked is a feature outage for the entire user base, not a courtroom.
- **AI-summary fair use is unsettled but trending favorably for output-time use.** [Bartz v. Anthropic (N.D. Cal. 23 June 2025)](https://cases.justia.com/federal/district-courts/california/candce/3:2024cv05417/434709/231/0.pdf) held LLM training on lawfully-acquired books "exceedingly transformative" — and explicitly distinguished [Thomson Reuters v. Ross (D. Del. 11 Feb. 2025)](https://www.ded.uscourts.gov/sites/ded/files/opinions/20-613_5.pdf) where non-generative use that competed directly with the source was not fair use. Brief's use — transient frames feeding a user-requested summary that links back to the source video — looks closer to Bartz than Ross. None of this binds Google as a contractual counterparty, however.
- **Brief currently has no Terms of Service.** Only a [Privacy Policy](https://brief.niftymonkey.dev/privacy) exists. Shipping frames without a user-facing ToS that addresses third-party content processing is the largest avoidable gap.

**Net recommendation:** Ship to the allowlist (repo owner + a handful of internal testers) as described in the plan, with the mitigations in §7 applied. Do **not** roll out to the public without (a) a published ToS on brief.niftymonkey.dev, (b) a vendor-mediated path or hardened operational posture that survives YouTube's anti-bot enforcement, and (c) a documented internal decision to accept the residual contract-breach risk.

---

## 1. The ToS picture today

### 1.1 The main YouTube Terms of Service

The current consumer ToS is [dated 15 December 2023](https://www.youtube.com/static?template=terms) and contains the operative restrictions under "Permissions and Restrictions." Verbatim:

> "access, reproduce, download, distribute, transmit, broadcast, display, sell, license, alter, modify or otherwise use any part of the Service or any Content except: (a) as expressly authorized by the Service; or (b) with prior written permission from YouTube..."
>
> "access the Service using any automated means (such as robots, botnets or scrapers) except (a) in the case of public search engines, in accordance with YouTube's robots.txt file; or (b) with YouTube's prior written permission..."
>
> "circumvent, disable, fraudulently engage with, or otherwise interfere with any part of the Service (or attempt to do any of these things), including security-related features or features that (a) prevent or restrict the copying or other use of Content or (b) limit the use of the Service or Content..."

Two observations matter to brief's posture:

1. **The "download" prohibition is unconditional except for the two carve-outs.** Premium "save offline" and the rare "Download" button on creator-enabled videos are the only consumer-facing exceptions. Programmatic download via yt-dlp falls within neither.
2. **The "automated means" clause does not cleanly distinguish transcript fetching from video-byte download** — both are technically "access by automated means" outside `robots.txt`. The reason transcript fetching is broadly tolerated is enforcement-driven (no IP blocks, no DMCA notices, ecosystem of tolerated tools), not text-driven.

### 1.2 The YouTube API Services ToS

The [API Services ToS](https://developers.google.com/youtube/terms/api-services-terms-of-service) and [Developer Policies](https://developers.google.com/youtube/terms/developer-policies-guide) govern the YouTube Data API, the IFrame Player API, and related sanctioned interfaces. The Data API exposes captions but **does not** expose raw video bytes; there is no sanctioned API path to do what the frames feature needs. The [Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality) document spells out what API Clients embedding the player must preserve (ads, branding, full playback controls). It does not contemplate frame extraction at all.

Implication: there is no compliant API-mediated path to the frames feature. Going through the Data API does not solve the problem; it sidesteps a different problem (metadata + captions retrieval, which brief already handles via Supadata and `youtube-transcript-plus`).

### 1.3 Robots.txt

YouTube's `robots.txt` allows public search engines to index a narrow set of paths and disallows most others to general bots. Compliance with `robots.txt` is the consumer ToS's literal exception for automated access — but only for "public search engines." brief is not a search engine. Respecting `robots.txt` is good citizenship but does not unlock the carve-out.

### 1.4 Transcript fetching vs video-byte download

This distinction does not appear in the ToS text — both are "automated access" and both involve "Content." It appears in enforcement reality:

| Operation | What it hits | YouTube's observed response | Ecosystem |
|---|---|---|---|
| Transcript via `timedtext` endpoint | Public CDN, low bandwidth | No blocks; tolerated for years | NotebookLM, Eightify, Glasp, Supadata, dozens of others |
| `youtube-transcript-plus` (browser-mimicking, no API) | Public web page parse | Tolerated; occasional `consent`-page friction | Most "summarize this video" extensions |
| yt-dlp video-bytes download | Same CDN endpoints browsers hit, but full audio+video stream | Targeted: datacenter-IP blocks, "Sign in to confirm you're not a bot" challenges starting Aug 2024 | yt-dlp itself; downstream tooling working around blocks |
| Official Data API (captions) | Authorized API with key | Quota-enforced, fully sanctioned | Anyone with an API key |

YouTube has never quietly tolerated full-video programmatic download the way it tolerates transcript fetch.

---

## 2. Precedent

### 2.1 RIAA v. youtube-dl (October–November 2020)

Direct primary sources:
- [GitHub's reinstatement post (16 Nov 2020)](https://github.blog/news-insights/policy-news-and-insights/standing-up-for-developers-youtube-dl-is-back/)
- [EFF's letter to GitHub (15 Nov 2020, PDF)](https://www.eff.org/files/2020/11/17/eff_letter_to_github_re_youtube-dl_11152020.pdf)
- [Techdirt coverage (17 Nov 2020)](https://www.techdirt.com/2020/11/17/github-eff-push-back-against-riaa-reinstate-youtube-dl-repository/)
- [The Register (16 Nov 2020)](https://www.theregister.com/2020/11/16/github_restores_youtubedl/)

The RIAA sent a [DMCA §1201 takedown](https://github.com/github/dmca/blob/master/2020/10/2020-10-23-RIAA.markdown) arguing youtube-dl's purpose was to circumvent the "rolling cipher" YouTube applies to its streaming URLs. GitHub took down the repository; EFF, acting for the maintainers, argued in its letter that:

1. youtube-dl does not "circumvent" any TPM — it executes the same JavaScript a browser would, with the same effect of decoding the signed URL.
2. The signature scheme is **not** a technological measure that effectively controls access for §1201 purposes, because it doesn't prevent access; it merely defends against direct-link sharing.
3. youtube-dl has substantial non-infringing uses (journalism, accessibility, archiving creator's own content).

GitHub reinstated on 16 November 2020, committed to expert review for future §1201 claims, and established a $1M open source legal defense fund. The RIAA did not pursue further action against the project.

**What this implies for brief:** the tool itself is legally robust. The argument that *using* yt-dlp triggers §1201 liability for the downstream consumer is correspondingly weak — the underlying premise (that yt-dlp circumvents a TPM) has been publicly contested and abandoned. Based on the current public record, §1201 appears to be a low-probability exposure for brief — not zero, but well-supported as a tolerable risk by precedent.

What it does **not** establish: that YouTube cannot enforce its ToS contract against a downstream consumer for breach. That's a separate cause of action with separate elements.

### 2.2 hiQ Labs v. LinkedIn — CFAA does not cover public-data scraping

[Ninth Circuit opinion on remand, 18 April 2022 (PDF)](https://cdn.ca9.uscourts.gov/datastore/opinions/2022/04/18/17-16783.pdf). After [Van Buren v. United States (2021)](https://www.supremecourt.gov/opinions/20pdf/19-783_k53l.pdf) narrowed CFAA's "exceeds authorized access" to gated areas a user cannot access at all (not data they're allowed to see but shouldn't use for a particular purpose), the Ninth Circuit affirmed that scraping publicly-viewable LinkedIn profiles is not a CFAA violation.

**What this implies for brief:** federal criminal exposure under CFAA is essentially off the table for scraping public, unauthenticated YouTube video pages. The case-law also leaves the door explicitly open to other claims — tortious interference, breach of contract, and state-level computer-misuse statutes (notably California Penal Code §502(c)) — and the LinkedIn opinion explicitly noted that "victims of data scraping are not without resort." YouTube would not need CFAA; it has its own ToS contract.

### 2.3 Authors Guild v. Google — transformative-use precedent

The Second Circuit's 2015 Google Books opinion held that scanning entire books to build a searchable index returning small snippets was transformative fair use. This is the foundational case for "input copying for transformative output is not infringement." It is widely cited in AI-training cases and is supportive of brief's use shape: ingest full content briefly, return a transformed, value-added summary.

### 2.4 Thomson Reuters v. Ross Intelligence — first AI-training fair-use loss

[D. Del. opinion, 11 February 2025 (PDF)](https://www.ded.uscourts.gov/sites/ded/files/opinions/20-613_5.pdf). Judge Bibas (sitting by designation) granted summary judgment **against** fair use. The court found Ross's use was not transformative because Ross's product (legal research) directly competed with Westlaw's headnotes, and the AI involved was not generative.

Coverage: [Jenner & Block alert](https://www.jenner.com/en/news-insights/publications/client-alert-court-decides-that-use-of-copyrighted-works-in-ai-training-is-not-fair-use-thomson-reuters-enterprise-centre-gmbh-v-ross-intelligence-inc), [BitLaw summary](https://www.bitlaw.com/source/cases/copyright/Thomson-Reuters-Ross.html).

**Implication for brief:** worth noting because it cuts the other way. The distinguishing facts are (i) Ross was a competitor to Thomson Reuters, (ii) Ross's AI was a retrieval tool, not generative, (iii) the headnotes were creative editorial content. None of those map cleanly to brief: brief is not a competitor to YouTube, the LLM output is generative, and frame analysis is generating descriptions rather than copying the underlying expressive content.

### 2.5 Bartz v. Anthropic — first AI-training fair-use win

[N.D. Cal. summary judgment order, 23 June 2025 (PDF)](https://cases.justia.com/federal/district-courts/california/candce/3:2024cv05417/434709/231/0.pdf). Coverage: [Akin Gump](https://www.akingump.com/en/insights/ai-law-and-regulation-tracker/district-court-rules-ai-training-can-be-fair-use-in-bartz-v-anthropic), [Publishers Weekly](https://www.publishersweekly.com/pw/by-topic/digital/copyright/article/98089-federal-judge-rules-ai-training-is-fair-use-in-anthropic-copyright-case.html), [ArentFox Schiff](https://www.afslaw.com/perspectives/alerts/landmark-ruling-ai-copyright-fair-use-vs-infringement-bartz-v-anthropic).

Judge Alsup ruled:

1. Training Claude on lawfully-acquired books is "exceedingly transformative" — fair use. The court compared training to a human reading copyrighted material to learn to write better.
2. Destructively scanning purchased books into a digital library is fair use (format-shifting analog to *Sony Betamax*).
3. Building a permanent library from **pirated** copies is not fair use, even if those copies were later used for fair-use training.

Crucially, the court distinguished Ross: there was no fair use in Ross because Ross was building a competitor that did not generate new content. Anthropic, generating "fresh" writing, was different.

**Implication for brief:** the input-copying done by the frames feature (download video → extract frames → discard video) is much closer to Bartz's lawful "ephemeral training input" theory than to Ross's "competing retrieval product." The wrinkle is acquisition: Bartz cut for Anthropic when the books were lawfully purchased, against Anthropic when pirated. yt-dlp downloads from YouTube are not "pirated" in the Bartz sense (the videos are publicly accessible at no cost), but the acquisition method does violate the platform ToS — which sits in legal territory not directly addressed by Bartz.

### 2.6 NYT v. OpenAI — pending

The most-cited generative-AI copyright case remains in discovery as of May 2026; no final ruling on fair use. Not directly load-bearing for brief's decision, but worth tracking — an output-side ruling (memorization of training content, near-verbatim regurgitation) would matter for the LLM ecosystem more broadly.

### 2.7 OpenAI Whisper / YouTube — April 2024 NYT reporting

[The Verge, 6 April 2024](https://www.theverge.com/2024/4/6/24122915/openai-youtube-transcripts-training-data): OpenAI transcribed over a million hours of YouTube videos using Whisper to train GPT-4, knowing it was "legally questionable" but believing it was fair use. Google spokesperson Matt Bryant told The Verge: *"Both our robots.txt files and Terms of Service prohibit unauthorized scraping or downloading of YouTube content."* YouTube CEO Neal Mohan separately told Bloomberg that OpenAI using YouTube videos to train Sora would be a "clear violation" of policies.

The reported facts also show **Google itself transcribed YouTube videos for Gemini training** ([9to5Google coverage](https://9to5google.com/2024/04/08/youtube-rules-openai-google-training-data-report/), [Engadget](https://www.engadget.com/openai-and-google-reportedly-used-transcriptions-of-youtube-videos-to-train-their-ai-models-163531073.html)). Google says it does so with creator-consented videos; the NYT report alleges this is broader than disclosed.

**Implication for brief:** Google's stated posture is hostile to unauthorized scraping/download. Google's actual enforcement against OpenAI was: a public statement; no lawsuit; no DMCA filed publicly. Whether OpenAI's posture is replicable at brief's scale is a different question — OpenAI's profile attracts both more public attention and more enforcement-friction tolerance from Google than a small dogfood tool would attract. The asymmetry cuts both ways.

---

## 3. Enforcement reality (not the courtroom)

### 3.1 The August 2024 "Sign in to confirm you're not a bot" wave

Starting June–August 2024, YouTube rolled out anti-bot challenges that broke yt-dlp at scale. yt-dlp issues thread: [#10128](https://github.com/yt-dlp/yt-dlp/issues/10128) is the canonical tracker; subsequent duplicates ([#12264](https://github.com/yt-dlp/yt-dlp/issues/12264), [#12475](https://github.com/yt-dlp/yt-dlp/issues/12475), [#12705](https://github.com/yt-dlp/yt-dlp/issues/12705), [#13682](https://github.com/yt-dlp/yt-dlp/issues/13682)) confirm the pattern through 2025–2026. Maintainers' summary, [issue #12475 thread](https://github.com/yt-dlp/yt-dlp/issues/12475):

> "YouTube blocked anonymous access from many datacenter IPs."
> "Either don't use a datacenter IP. Or read the following wiki page on how to export cookies... Do note that Google will block/ban accounts for abusive behavior."

This is the operational picture brief will face the day it ships:

- **Anonymous, datacenter-hosted access (e.g., Vercel functions, default cloud egress) is reliably blocked**, often permanently for repeat offenders.
- **Authenticated access with browser-exported cookies works** but ties throughput to one or more YouTube accounts, which Google can and does suspend for "abusive behavior."
- **Residential-IP traffic** (the user's own browser, or residential proxies) is not blocked but has its own legal and operational problems.

The functional consequence is that brief's server-side `extractFrames()` pipeline running on Vercel or any standard cloud host will likely **fail outright** for many videos within days or weeks of broad rollout. This is the dominant risk — not litigation. A feature that works in the spike on a residential developer machine often fails the day it's deployed.

### 3.2 Direct enforcement against summarization / transcription tools

Public record search for DMCA notices, cease-and-desist letters, or lawsuits filed by YouTube against:
- transcript fetchers (`youtube-transcript`, `youtube-transcript-plus`, Supadata, Apify scrapers)
- AI-summary products (Eightify, Glasp, NoteGPT, "YouTube Summary with ChatGPT")
- yt-dlp downstream consumers as a class

→ no public actions found. The 2020 RIAA takedown was against the tool, not a consumer; was driven by music-industry rightsholders, not by YouTube; and resulted in reinstatement.

Caveat: absence of public enforcement does not equal tolerance — many cease-and-desist letters are private and never surface unless escalated. But the lack of public-record action against any class of yt-dlp consumer over five years is real signal.

### 3.3 §1201 anti-circumvention — settled enough

The combined effect of RIAA v. youtube-dl's resolution and the EFF letter (which Google has never publicly contested in any forum) is that yt-dlp's signature-decoding logic is not treated as §1201 circumvention. No subsequent case has tested it. Based on current public precedent, using yt-dlp is unlikely to create primary §1201 exposure for brief.

---

## 4. Comparable products — what others do

Survey of products that look like brief, looked up by their published behavior:

| Product | Mechanism | Posture |
|---|---|---|
| **NotebookLM** ([Google support article](https://support.google.com/notebooklm/answer/16454555)) | Captions/transcripts only via YouTube's own internal access. Cannot ingest videos without captions. Generates "Video Overviews" of *its own*, not extracted YouTube frames. | First-party, sanctioned. |
| **Eightify, Glasp, NoteGPT, "YouTube Summary with ChatGPT"** | Transcript text via public CDN endpoints. No video-byte download. | Broadly tolerated; ecosystem default. |
| **Supadata** ([brief uses this today](./architecture/transcript-cli.md)) | Vendor-mediated transcript API. Handles ToS friction on the consumer's behalf. | Tolerated; commercial vendor with public SLA. |
| **Apify / Bright Data YouTube scrapers** | Headless browser sessions and proxies; can extract frames in principle but marketed for metadata and transcripts. | Vendor takes the operational hit; consumer pays for the workaround infrastructure. |

No widely-deployed consumer-facing product currently downloads YouTube video bytes for AI summarization. brief would be doing something new in the consumer-AI-summary space — not unprecedented technically, but unprecedented in shipped products that are publicly attributable to a company.

The closest analog is **OpenAI's Whisper-on-YouTube training pipeline**, which Google described as a "clear violation" but took no public action against.

---

## 5. Brief's own ToS posture

[brief.niftymonkey.dev](https://brief.niftymonkey.dev/) currently exposes one legal artifact: a [Privacy Policy](https://brief.niftymonkey.dev/privacy). There is no Terms of Service, no Acceptable Use Policy, no user agreement.

### What the Privacy Policy does today

The policy describes (as of the version dated when this research was written):

- Brief accepts a YouTube video URL submitted by the user.
- Brief uses Supadata to fetch the transcript.
- Brief uses Anthropic Claude to generate a summary.
- Brief stores the resulting brief as long as the user's account exists; users can delete individual summaries.
- Brief does not use user data for advertising, analytics profiling, or any non-service purpose.

### What it does not address

- Third-party content (YouTube videos) being processed on the user's behalf.
- Whether the user is responsible for ensuring they have the right to summarize a given video.
- Storage retention specifics for video bytes (currently irrelevant — brief never touches bytes today).
- What happens if YouTube changes its ToS or terminates brief's access.
- Acceptable use of brief itself (no spam, no harassment, no abuse of allowlist features).

### What it should add before the frames feature ships

A minimal Terms of Service / Acceptable Use Policy at `/terms`, linked from the homepage footer and the per-digest checkbox, covering at minimum:

1. **Third-party content disclaimer.** "By submitting a YouTube URL you represent that you have the right to request a summary of that video for your personal use." Mirrors the [youtubetranscripts.net pattern](https://youtubetranscripts.net/terms) and similar AI-summary services.
2. **Frames-specific consent.** "When you opt into Include video frames, brief retrieves short visual samples from the video to enrich your summary. Video bytes are processed in memory and not retained; only a small set of extracted frames may be stored briefly during processing." This is the load-bearing disclosure for the frames feature.
3. **YouTube ToS pass-through.** "Your use of brief does not modify the YouTube Terms of Service that govern your access to videos. brief is not affiliated with YouTube or Google."
4. **Service availability.** "brief depends on third-party services (YouTube, Anthropic, Supadata, WorkOS, Vercel) that may change their terms or availability without notice. brief may suspend or modify features in response."
5. **Personal, non-commercial use restriction.** Mirrors YouTube's main ToS — users may use brief output for personal purposes; redistribution is at their own risk.
6. **Allowlist gating disclosure.** "Some features are limited to invited users during a testing period."

The point of the ToS is not magic legal protection. It is (a) putting the user on notice of what brief does with their submitted URL, (b) creating a contract that allows brief to terminate abusive accounts, and (c) showing a good-faith posture if Google ever raises a concern.

---

## 6. Fair-use posture for the output

The frames feature's *output* shape — a generated text summary, sometimes referencing what's visible in specific frames, attributable back to the source video — is closer to a permitted fair use than the input acquisition is to permitted access. Three precedents support this:

- **Kelly v. Arriba Soft (9th Cir. 2003)** — full-image scraping to produce small thumbnails for image search was transformative fair use. Frame extraction → vision LLM → text summary is at least as transformative as image-to-thumbnail.
- **Authors Guild v. Google Books (2d Cir. 2015)** — full-book scanning to enable snippet search returning small extracts was fair use because the use was transformative and the market harm to the books was negligible (search drove sales).
- **Bartz v. Anthropic (N.D. Cal. 2025)** — generative output from copyrighted training inputs was "exceedingly transformative." The narrow distinction was pirated vs lawfully-acquired *inputs*.

The frames feature output:

- is transformative (text description of a visual scene, not a reproduction)
- is small relative to the source (a 30-minute video → ~500-word summary)
- references the source rather than substituting for it (linked back, attribution)
- does not harm the market for the original video (and arguably drives engagement; brief explicitly links to the source)

This is a strong fair-use posture *for the output*. It does **not** rescue brief from a breach-of-contract claim against YouTube — fair use defends against copyright claims, not against contractual restrictions a user agreed to.

---

## 7. Mitigations — what actually moves the needle

Honest evaluation of each:

### 7.1 Mitigations that materially reduce risk

- **Allowlist + per-digest opt-in (already planned).** Limits the population that can trigger the operation to a small, identifiable, internally-consented set. Reduces both YouTube-side enforcement signal and end-user surprise.
- **Transient processing of video bytes.** Deletion-after-extraction does meaningfully reduce the copyright-infringement claim surface (no "distribution," ephemeral "reproduction"). Bartz v. Anthropic explicitly cared about whether copies were retained. Make this an architectural invariant: write to a tmpdir, process, delete in `finally`, never log the path.
- **Public-only videos.** Refuse to process private/unlisted/age-gated videos. YouTube's ToS treats access to non-public content very differently, and CFAA exposure increases for anything behind authentication.
- **Brief Terms of Service at `/terms`.** See §5. This is the single largest avoidable gap and the lowest-cost mitigation.
- **Per-user rate limits.** Cap at e.g. 10 frame-extracted digests per user per day during dogfood; the existing 100-candidates cost cap addresses the within-video pathology but not the cross-video volume. Lower volume = lower enforcement signal, lower account-suspension risk.
- **Vendor-mediated path, when available.** Apify and Bright Data both market YouTube frame/screenshot capabilities as managed services. They take on the operational risk (proxies, anti-bot evasion) and arguably some legal posture. Worth concrete pricing/SLA evaluation before broad rollout. Supadata is the model — they front the ToS friction; brief consumes a clean API.

### 7.2 Mitigations that *don't* move the needle as much as they look like they should

- **Respecting `robots.txt`.** brief is not a "public search engine," so the ToS carve-out for robots.txt-compliant crawlers does not apply. Compliance is good-citizenship signaling, not a legal shield.
- **Attribution / back-link to the source video.** Helpful for fair-use posture and good for creators, but does not affect breach-of-contract exposure.
- **Generic user consent.** "By clicking, you agree to YouTube's ToS" puts the user on notice but does not contractually transfer brief's own ToS exposure to the user. brief is the party making the automated requests.
- **Open-sourcing the feature.** Doesn't change the operational posture; brief is still the operator of brief.niftymonkey.dev.

### 7.3 Mitigations that are conditions of feasibility

- **Egress that survives YouTube's datacenter-IP blocks.** Without this, the feature doesn't work in production regardless of legal posture. Options: residential-IP proxies (cost, ethical concerns about residential proxy networks); routing through a vendor (Apify, Bright Data) that takes the hit; running the extraction on the user's own machine (a CLI-only future, defers the issue). All have implications; this is a tractable engineering problem but a real one.
- **Authentication via cookies — a trap.** yt-dlp can be passed a logged-in user's YouTube cookies, which bypasses the anti-bot challenge. Doing this server-side requires brief to either (a) collect users' YouTube cookies (privacy/trust nightmare, not viable), or (b) operate brief's own YouTube accounts (Google explicitly warns accounts used this way will be "block/ban[ned] for abusive behavior"). Neither is a stable production strategy.

---

## 8. Final recommendation

### 8.1 The signal

**Yellow → green for the allowlist dogfood phase**, with conditions enumerated below. **Yellow → red for general rollout** until either a vendor-mediated path is in place or YouTube's enforcement posture demonstrably shifts.

Risk picture by category, current vs mitigated:

| Risk | Current | Mitigated (allowlist + §7.1) | Mitigated (broad rollout, no vendor) |
|---|---|---|---|
| CFAA / criminal | Low | Low | Low |
| DMCA §1201 circumvention | Low (post-RIAA-v-yt-dl) | Low | Low |
| Copyright infringement (input copying) | Medium | Low (transient + small allowlist) | Medium |
| Copyright infringement (output) | Low (transformative summary) | Low | Low |
| Breach of YouTube ToS — contract claim | Medium | Medium (volume reduces probability, not size) | Medium-high |
| IP-level blocks / feature outage | High | Medium (per-user limits dampen) | High |
| Account suspension cascade if using YouTube login cookies | High if cookies are used | N/A (don't use cookies) | High if cookies are used |
| Reputational / PR if Google escalates publicly | Low at allowlist scale | Low | Medium |

The dominant residual risks in the mitigated allowlist scenario are operational (will the pipeline keep working?) and contractual (does YouTube ever decide brief specifically is a problem?). Neither is zero. Both are manageable for a dogfood phase.

### 8.2 Conditions to ship to the allowlist (issue D, "Add video frames to brief generation")

Issue D should not land without these. Each is a small, concrete artifact.

1. **Publish a Terms of Service** at `/terms` covering the items in §5. The current `/terms` route 307-redirects to WorkOS auth — i.e., the page does not exist. Fix this before the frames feature is enabled even for the repo owner.
2. **Implement transient processing as an architectural invariant.** Video bytes land in an OS-temp path, are processed, and are deleted in a `finally` block in the pipeline. No code path retains them. Add a unit test that asserts file absence after `extractFrames()` returns or throws.
3. **Hard-code public-only video acceptance.** If yt-dlp reports the video is private/unlisted/age-gated, return the existing `framesStatus: 'attempted-failed'` and fall back to transcript-only. Do not even attempt to bypass.
4. **Per-user, per-day rate limit on the frames operation.** Suggested initial value: 10 frame-augmented digests per user per UTC day. Enforced in the same row that gates the allowlist, not at the CDN.
5. **Document the operational fragility in `docs/video-frames-plan.md`.** Note that broad rollout depends on solving the datacenter-IP-block problem; that the maintainer accepts this is a dogfood-only feature until that's solved; and what "solved" looks like.
6. **Do not store YouTube login cookies.** Do not attempt cookie-authenticated yt-dlp pulls server-side, even as a fallback. If a video requires login, fall back to transcript-only.

### 8.3 Conditions to consider broader rollout (post-issue-D)

These are not blockers for the allowlist dogfood but are blockers for taking the checkbox out from behind the allowlist gate.

1. **Vendor-mediated frame extraction path or equivalently durable egress.** Evaluate Apify, Bright Data, and any newer vendor specifically marketing YouTube-frame extraction. Acceptable definition: 95%+ success rate over a representative video sample for 30 consecutive days.
2. **A second look at the legal picture if a precedent moves.** Bartz v. Anthropic is on appeal; NYT v. OpenAI may decide; the EU AI Act's training-data rules may surface a US analog. Any of these landing would reset the analysis.
3. **Internal go/no-go memo** that explicitly accepts the residual contract-breach risk. Not a legal artifact, just a written record: "the maintainer has read this research, has decided to ship anyway, here are the conditions under which we would pull the feature."

### 8.4 Things that would lock the recommendation at red

If any of the following becomes true before ship, the recommendation flips:

- YouTube sends brief or the maintainer a cease-and-desist (about anything — even today's transcript usage). The signal value is enormous and should be respected.
- A new district court ruling explicitly addresses scraping for AI summarization and rules against the operator (Ross-style reasoning applied to a generative-output product).
- Google announces a sanctioned API path for frame extraction. At that point, doing it the hard way looks much worse in any subsequent enforcement context.
- The frames feature is repositioned from "summary enrichment" to "video archive" or "video search" — anything that smells like substitution for YouTube rather than complement to YouTube.

---

## 9. What this document does not do

- It is not legal advice. It is research synthesis intended to inform a maintainer's ship decision. If brief is acquired, takes investment, or grows past the allowlist phase, a real lawyer should review this analysis with current facts.
- It cannot predict YouTube's enforcement choices, which are opaque, asymmetric, and not necessarily principled.
- It does not address non-US jurisdictions. brief is hosted in the US, but EU users introduce GDPR considerations for the privacy policy that are separate from this analysis. The EU AI Act's training-data transparency rules may also become relevant if brief is ever interpreted as conducting AI training (it is not, today — brief is an AI consumer, not trainer).

## 10. References

Primary legal documents:
- [YouTube Terms of Service, dated 15 December 2023](https://www.youtube.com/static?template=terms)
- [YouTube API Services Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service)
- [YouTube Developer Policies](https://developers.google.com/youtube/terms/developer-policies-guide)
- [YouTube API Services Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [YouTube API Services TOS revision history](https://developers.google.com/youtube/terms/revision-history)

Case law (court opinions and primary docs):
- [Van Buren v. United States, 593 U.S. ___ (2021)](https://www.supremecourt.gov/opinions/20pdf/19-783_k53l.pdf)
- [hiQ Labs, Inc. v. LinkedIn Corp., 31 F.4th 1180 (9th Cir. 2022)](https://cdn.ca9.uscourts.gov/datastore/opinions/2022/04/18/17-16783.pdf)
- [Thomson Reuters Enterprise Centre GmbH v. Ross Intelligence Inc., No. 1:20-cv-613-SB (D. Del. Feb. 11, 2025)](https://www.ded.uscourts.gov/sites/ded/files/opinions/20-613_5.pdf)
- [Bartz v. Anthropic PBC, No. 3:24-cv-05417 (N.D. Cal. June 23, 2025)](https://cases.justia.com/federal/district-courts/california/candce/3:2024cv05417/434709/231/0.pdf)

RIAA v. youtube-dl record:
- [EFF letter to GitHub re youtube-dl, 15 Nov 2020](https://www.eff.org/files/2020/11/17/eff_letter_to_github_re_youtube-dl_11152020.pdf)
- [GitHub: "Standing up for developers: youtube-dl is back," 16 Nov 2020](https://github.blog/news-insights/policy-news-and-insights/standing-up-for-developers-youtube-dl-is-back/)
- [Techdirt: GitHub, EFF Push Back Against RIAA, 17 Nov 2020](https://www.techdirt.com/2020/11/17/github-eff-push-back-against-riaa-reinstate-youtube-dl-repository/)
- [The Register: GitHub restores DMCA-hit youtube-dl code repo, 16 Nov 2020](https://www.theregister.com/2020/11/16/github_restores_youtubedl/)

Press coverage of AI-training cases and Whisper/YouTube:
- [The Verge: OpenAI transcribed over a million hours of YouTube videos to train GPT-4](https://www.theverge.com/2024/4/6/24122915/openai-youtube-transcripts-training-data)
- [9to5Google: YouTube rules broken by OpenAI and Google for training data](https://9to5google.com/2024/04/08/youtube-rules-openai-google-training-data-report/)
- [Engadget: OpenAI and Google reportedly used transcriptions of YouTube videos to train their AI models](https://www.engadget.com/openai-and-google-reportedly-used-transcriptions-of-youtube-videos-to-train-their-ai-models-163531073.html)
- [Jenner & Block: Court Decides that Use of Copyrighted Works in AI Training Is Not Fair Use (Thomson Reuters v. Ross)](https://www.jenner.com/en/news-insights/publications/client-alert-court-decides-that-use-of-copyrighted-works-in-ai-training-is-not-fair-use-thomson-reuters-enterprise-centre-gmbh-v-ross-intelligence-inc)
- [Akin Gump: District Court Rules AI Training Can Be Fair Use in Bartz v. Anthropic](https://www.akingump.com/en/insights/ai-law-and-regulation-tracker/district-court-rules-ai-training-can-be-fair-use-in-bartz-v-anthropic)
- [Publishers Weekly: Federal Judge Rules AI Training Is Fair Use in Anthropic Copyright Case](https://www.publishersweekly.com/pw/by-topic/digital/copyright/article/98089-federal-judge-rules-ai-training-is-fair-use-in-anthropic-copyright-case.html)
- [ArentFox Schiff: Landmark Ruling on AI Copyright (Bartz v. Anthropic)](https://www.afslaw.com/perspectives/alerts/landmark-ruling-ai-copyright-fair-use-vs-infringement-bartz-v-anthropic)

YouTube enforcement evidence:
- [yt-dlp issue #10128: "[youtube] Sign in to confirm you're not a bot"](https://github.com/yt-dlp/yt-dlp/issues/10128) — canonical tracker
- [yt-dlp issue #12264](https://github.com/yt-dlp/yt-dlp/issues/12264), [#12475](https://github.com/yt-dlp/yt-dlp/issues/12475), [#12705](https://github.com/yt-dlp/yt-dlp/issues/12705), [#13682](https://github.com/yt-dlp/yt-dlp/issues/13682) — confirming datacenter-IP block pattern through 2025–2026

Comparable products:
- [NotebookLM: Generate Video Overviews](https://support.google.com/notebooklm/answer/16454555)
- [youtubetranscripts.net Terms of Service](https://youtubetranscripts.net/terms) — example pattern for AI-summary service ToS

brief's own surfaces:
- [brief Privacy Policy](https://brief.niftymonkey.dev/privacy)
- (No published Terms of Service as of this writing — gap to close before frames ships.)
