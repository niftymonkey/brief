import { existsSync, readFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { FramesFailReason } from "./types";

/**
 * Output of a `download(videoId, workDir)` call. Either the local paths to
 * cached video + info JSON, or a discriminated failure tag that the
 * orchestrator translates into a `FramesResult.attempted-failed`.
 */
export type DownloadResult =
  | { kind: "ok"; videoPath: string; infoPath: string; durationSec: number }
  | { kind: "failed"; reason: FramesFailReason; message: string };

/**
 * Internal seam between the orchestrator and the local-binary `yt-dlp`. Phase
 * 4 swaps the default production adapter for a stub in integration tests.
 * Production adapter shells out to `yt-dlp` and parses its `info.json` for
 * duration metadata.
 */
export interface DownloadAdapter {
  download(videoId: string, workDir: string): Promise<DownloadResult>;
  /** Reports `yt-dlp` if absent from PATH so the orchestrator can short-circuit preflight. */
  isAvailable(): boolean;
}

const ANTIBOT_PATTERN = /sign in to confirm you'?re not a bot/i;
const PRIVATE_PATTERN = /private|members-only|sign in|age-restricted|login required/i;

export function createYtDlpAdapter(): DownloadAdapter {
  return {
    isAvailable() {
      return spawnSync("which", ["yt-dlp"], { encoding: "utf8" }).status === 0;
    },
    async download(videoId, workDir) {
      const videoPath = resolve(workDir, `${videoId}.mp4`);
      const infoPath = resolve(workDir, `${videoId}.info.json`);

      if (!existsSync(videoPath) || !existsSync(infoPath)) {
        try {
          execSync(
            `yt-dlp -f 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]' --merge-output-format mp4 --write-info-json -o '${videoId}.%(ext)s' '${videoId}'`,
            { cwd: workDir, stdio: "pipe" },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const reason: FramesFailReason = ANTIBOT_PATTERN.test(message)
            ? "download-blocked-bot-detection"
            : PRIVATE_PATTERN.test(message)
              ? "video-not-public"
              : "download-failed";
          return { kind: "failed", reason, message };
        }
      }

      let durationSec = 0;
      try {
        const info = JSON.parse(readFileSync(infoPath, "utf8")) as { duration?: number };
        durationSec = info.duration ?? 0;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { kind: "failed", reason: "download-failed", message: `Could not parse info.json: ${message}` };
      }

      return { kind: "ok", videoPath, infoPath, durationSec };
    },
  };
}
