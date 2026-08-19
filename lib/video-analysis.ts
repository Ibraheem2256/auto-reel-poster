import { spawn } from "child_process";
import { createWriteStream, mkdtempSync, promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import ffmpegPath from "ffmpeg-static";
import { streamVideoFromDrive } from "@/lib/storage";
import { analyzeVideoFrames, type VideoAnalysis } from "@/lib/ai";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/utils";
import type { Video } from "@prisma/client";

const MAX_FRAME_BYTES = 3 * 1024 * 1024; // per-frame cap
const FRAME_TIMEOUT_MS = 90_000;
const ANALYSIS_TIMEOUT_MS = 60_000;

const analysisCache = new Map<string, VideoAnalysis>();
const MAX_CACHE_SIZE = 200;

/** Clear the in-memory analysis cache (used by tests). */
export function clearAnalysisCache(): void {
  analysisCache.clear();
}

export function videoAnalysisCacheKey(videoId: string): string {
  return videoId;
}

/**
 * Extract up to N JPEG frames from a Drive video by downloading it to a
 * temporary file (seekable — required for MP4s with a trailing moov atom,
 * which ffmpeg cannot demux from a pipe) and running ffmpeg on it. The temp
 * file is deleted immediately after extraction. Nothing is stored permanently.
 */
export async function extractFramesFromDrive(
  workspaceId: string,
  driveFileId: string,
  frameCount = 3
): Promise<{ mimeType: string; base64: string }[]> {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not found.");

  let tempDir: string | null = null;
  try {
    const driveStream = await streamVideoFromDrive(workspaceId, driveFileId);

    // 1. Stream the Drive file into a temporary file (seekable input).
    tempDir = mkdtempSync(join(tmpdir(), "arp-frames-"));
    const tempFile = join(tempDir, "video.bin");
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(tempFile);
      driveStream.on("error", reject);
      out.on("error", reject);
      out.on("finish", resolve);
      driveStream.pipe(out);
    });

    // 2. Extract frames from the temp file.
    const ffmpeg = spawn(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      tempFile,
      "-vf",
      `thumbnail=${Math.max(20, Math.floor(300 / frameCount))},scale=384:-2`,
      "-frames:v",
      String(frameCount),
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ]);

    const frames: Buffer[] = [];
    let stderr = "";
    let total = 0;

    const timeout = setTimeout(() => {
      ffmpeg.kill("SIGKILL");
    }, FRAME_TIMEOUT_MS);

    await new Promise<void>((resolve, reject) => {
      ffmpeg.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      // JPEG frames can arrive split across chunks — accumulate raw bytes and
      // split on JPEG SOI markers (0xFF 0xD8 0xFF) so partial images are
      // never sent to the vision model.
      let raw: Buffer[] = [];

      ffmpeg.stdout.on("data", (chunk: Buffer) => {
        raw.push(chunk);
        total += chunk.length;
        if (total > MAX_FRAME_BYTES * frameCount * 2) {
          ffmpeg.kill("SIGKILL");
          clearTimeout(timeout);
          reject(new Error("Frame extraction exceeded memory cap."));
        }
      });

      ffmpeg.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      ffmpeg.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0 || total === 0) {
          reject(new Error(`Frame extraction failed (code ${code}): ${stderr.slice(0, 300)}`));
          return;
        }
        const stream = Buffer.concat(raw);
        const jpegs: Buffer[] = [];
        let start = 0;
        for (let i = 0; i + 2 < stream.length; i++) {
          if (stream[i] === 0xff && stream[i + 1] === 0xd8 && stream[i + 2] === 0xff) {
            if (i > start) jpegs.push(stream.subarray(start, i));
            start = i;
          }
        }
        if (start < stream.length) jpegs.push(stream.subarray(start));
        frames.push(...jpegs.slice(0, frameCount));
        if (frames.length === 0) {
          reject(new Error(`Frame extraction produced no valid frames: ${stderr.slice(0, 200)}`));
          return;
        }
        resolve();
      });
    });

    return frames.map((f) => ({ mimeType: "image/jpeg", base64: f.toString("base64") }));
  } finally {
    // 3. Always delete the temporary file and directory.
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Analyze a video by extracting frames and running vision analysis.
 * Never throws — returns null when analysis is unavailable so publishing
 * always continues with filename-based content.
 */
export async function analyzeVideo(
  workspaceId: string,
  video: Video,
  opts?: { timeoutMs?: number }
): Promise<VideoAnalysis | null> {
  if (analysisCache.has(video.id)) return analysisCache.get(video.id)!;

  let frames: { mimeType: string; base64: string }[];
  try {
    const timeout = opts?.timeoutMs ?? ANALYSIS_TIMEOUT_MS;
    frames = await Promise.race([
      extractFramesFromDrive(workspaceId, video.driveFileId, 2),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Frame extraction timed out.")), timeout)
      ),
    ]);
  } catch (err) {
    logger.warn("video_analysis_extract_failed", { videoId: video.id, error: getErrorMessage(err) });
    return null;
  }

  try {
    const analysis = await analyzeVideoFrames({
      fileName: video.fileName,
      durationMs: video.durationMs,
      frames,
    });
    analysisCache.set(video.id, analysis);
    if (analysisCache.size > MAX_CACHE_SIZE) analysisCache.clear();
    logger.info("video_analysis_done", { videoId: video.id });
    return analysis;
  } catch (err) {
    logger.warn("video_analysis_failed", { videoId: video.id, error: getErrorMessage(err) });
    return null;
  }
}
