# Two-stage funnel for Topic runs

A Topic run can see hundreds of Candidates a week, and reading a transcript is the expensive step: it needs a residential fetch under a rate limit we cannot see, plus a paid model pass. We decided to run every Candidate through a cheap metadata-only survey first (title, description, channel, publish time, view count) that groups them and pulls out Subjects and Framing, and to fetch transcripts only for the few groups that clear the read rule, and only for the most-viewed few videos in each. The obvious design, a per-video floor where anything above some view count gets read, was rejected because it reads what is already loud and skips the slow shifts the tool exists to catch.

## Consequences

- Candidate rows exist for videos Brief never read, and they keep their title, channel, publish date, Subjects, and Framing forever, so a later question can distinguish "nothing changed" from "we never looked."
- A Report may only assert what a transcript supported. Stage one groups wrongly sometimes, because titles are marketing, and only stage two can correct it.
