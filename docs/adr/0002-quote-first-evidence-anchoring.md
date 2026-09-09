# Quote-first evidence anchoring

Every claim in a Report must point at a moment in a video. The obvious way is to ask the model for a timestamp, which it will produce whether or not the moment exists. We decided instead that the writer emits a short verbatim transcript quote, and code searches the transcript for that quote and reads the timestamp off the matching entry. A quote that does not match is a claim with no evidence, and the claim is dropped or flagged rather than published.

## Consequences

- Developments store quotes, not times; times are derived at write time and can be re-derived.
- The anchor match rate is recorded per Report as the one quality signal the system has about its own writer.
