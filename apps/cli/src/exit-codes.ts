import type { TranscriptResult } from "@brief/core";

export function mapExitCode(transcript: TranscriptResult): 0 | 2 | 3 | 4 {
  switch (transcript.kind) {
    case "ok":
      return 0;
    case "pending":
      return 2;
    case "unavailable":
      return 3;
    case "transient":
      return 4;
  }
}
