import type { TranscriptResult } from "@brief/core";

export const EXIT_OK = 0;
export const EXIT_ARG_ERROR = 1;
export const EXIT_PENDING = 2;
export const EXIT_UNAVAILABLE = 3;
export const EXIT_TRANSIENT = 4;
export const EXIT_AUTH_REQUIRED = 5;
export const EXIT_SCHEMA_MISMATCH = 6;

export function mapExitCode(transcript: TranscriptResult): 0 | 2 | 3 | 4 {
  switch (transcript.kind) {
    case "ok":
      return EXIT_OK;
    case "pending":
      return EXIT_PENDING;
    case "unavailable":
      return EXIT_UNAVAILABLE;
    case "transient":
      return EXIT_TRANSIENT;
  }
}
