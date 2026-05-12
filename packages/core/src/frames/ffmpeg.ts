import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Local-binary adapter for `ffmpeg`. Two responsibilities, both per-frame in
 * principle: detect scene-change boundaries on the full video, and extract a
 * single PNG at a given timestamp. The orchestrator owns the candidate-list
 * sequencing; this adapter only knows about ffmpeg subprocess wiring.
 *
 * Frames are cached on disk by timestamp so re-runs on the same workDir skip
 * the extraction subprocess entirely — the production impl uses `existsSync`
 * before spawning ffmpeg.
 */
export interface FfmpegAdapter {
  detectScenes(videoPath: string, threshold: number): Promise<number[]>;
  extractFrameAt(videoPath: string, timestamp: number, outPath: string): Promise<void>;
  /** Reports `ffmpeg` if absent from PATH so the orchestrator can short-circuit preflight. */
  isAvailable(): boolean;
}

const SHOWINFO_TIME_RE = /\[Parsed_showinfo[^\]]*\][^\n]*pts_time:([\d.]+)/g;

export function createFfmpegAdapter(): FfmpegAdapter {
  return {
    isAvailable() {
      return spawnSync("which", ["ffmpeg"], { encoding: "utf8" }).status === 0;
    },

    async detectScenes(videoPath, threshold) {
      const result = spawnSync(
        "ffmpeg",
        [
          "-i", videoPath,
          "-vf", `select='gt(scene,${threshold})',showinfo`,
          "-an", "-f", "null", "-",
        ],
        { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
      );

      const times: number[] = [];
      let m: RegExpExecArray | null;
      while ((m = SHOWINFO_TIME_RE.exec(result.stderr))) times.push(parseFloat(m[1]));
      // Reset the global regex state so this function is safe to call repeatedly.
      SHOWINFO_TIME_RE.lastIndex = 0;
      return times;
    },

    async extractFrameAt(videoPath, timestamp, outPath) {
      if (existsSync(outPath)) return;
      const result = spawnSync(
        "ffmpeg",
        [
          "-ss", timestamp.toString(),
          "-i", videoPath,
          "-frames:v", "1",
          "-q:v", "1",
          "-y",
          "-loglevel", "error",
          outPath,
        ],
        { encoding: "utf8" },
      );
      if (result.status !== 0) {
        throw new Error(`ffmpeg frame extraction failed at t=${timestamp}: ${result.stderr}`);
      }
    },
  };
}

/**
 * Helper for the orchestrator: walks a candidate list, asks the adapter to
 * extract each frame to `<framesDir>/frame_t<X>s.png`, and writes the resulting
 * filename onto each Candidate. Skips frames that already exist on disk so the
 * per-videoId cache reuses prior runs.
 */
export async function extractAllFrames(
  candidates: Array<{ t: number; frame?: string }>,
  videoPath: string,
  framesDir: string,
  ffmpeg: FfmpegAdapter,
): Promise<void> {
  const existing = new Set(readdirSync(framesDir));
  for (const c of candidates) {
    const filename = `frame_t${c.t.toFixed(2)}s.png`;
    c.frame = filename;
    if (existing.has(filename)) continue;
    await ffmpeg.extractFrameAt(videoPath, c.t, resolve(framesDir, filename));
  }
}
