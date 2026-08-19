import { spawn } from "child_process";
import { createWriteStream, promises as fs, readdirSync } from "fs";
import { join } from "path";
import ffmpegPath from "ffmpeg-static";
import * as ort from "onnxruntime-node";
import { logger } from "@/lib/logger";

/**
 * Real background removal using Robust Video Matting (RVM, MobileNetV3)
 * running on onnxruntime-node. Frames are streamed out of ffmpeg, each frame
 * is matted to produce an alpha mask, and the masks are written as PGM files
 * so ffmpeg can composite them (alphamerge + overlay) in the edit pipeline.
 *
 * Model: models/rvm_mobilenetv3_fp32.onnx (CC BY-NC 4.0, 15 MB).
 */

const MODEL_PATH = join(process.cwd(), "models", "rvm_mobilenetv3_fp32.onnx");
const MODEL_URL = "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx";

const REC_NAMES = ["r1i", "r2i", "r3i", "r4i"];
const REC_OUT_NAMES = ["r1o", "r2o", "r3o", "r4o"];

let sessionPromise: Promise<ort.InferenceSession> | null = null;

export function bgRemovalAvailable(): boolean {
  try {
    const { statSync } = require("fs") as typeof import("fs");
    return Boolean(ffmpegPath) && statSync(MODEL_PATH).size > 1_000_000;
  } catch {
    return false;
  }
}

export async function getRvmSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    });
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

export interface BgRemovalOptions {
  sourceFile: string;
  masksDir: string;
  /** Width/height the matte is computed at (keep small; it is upscaled). */
  width: number;
  height: number;
  /** Max seconds to process (for preview renders). 0 = all. */
  maxSeconds?: number;
  /** Trim start (seconds). Must match the composite command's -ss. */
  trimStartSec?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface BgRemovalResult {
  frameCount: number;
  width: number;
  height: number;
  fps: number;
  trimmedSeconds: number;
}

function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not found.");
  const binary: string = ffmpegPath;
  return new Promise((resolvePromise, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc = spawn(binary, args, { windowsHide: true }) as any;
    let stderr = "";
    proc.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    proc.on("error", (err: Error) => reject(err));
    proc.on("close", (code: number) => resolvePromise({ code: code ?? -1, stderr }));
  });
}

/** Probe fps of a video by scanning ffmpeg stderr. */
export async function probeFps(filePath: string): Promise<number> {
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", filePath]);
  const m = stderr.match(/(\d+(?:\.\d+)?)\s*fps/);
  if (m) {
    const fps = Number(m[1]);
    if (fps > 0 && fps <= 120) return fps;
  }
  return 30;
}

/**
 * Stream the video through ffmpeg as raw RGB frames, matte each frame with
 * RVM, and write per-frame PGM alpha masks into masksDir.
 */
export async function extractPersonMasks(opts: BgRemovalOptions): Promise<BgRemovalResult> {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not found.");
  const session = await getRvmSession();
  const W = opts.width;
  const H = opts.height;
  const frameBytes = W * H * 3;
  const fps = await probeFps(opts.sourceFile);

  // Stream raw RGB frames out of ffmpeg (one frame = W*H*3 bytes).
  // NOTE: the same -ss/-t must be used by the composite command so masks stay
  // frame-synced with the trimmed video.
  const seekArgs = opts.trimStartSec ? ["-ss", String(opts.trimStartSec)] : [];
  const extract = spawn(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    ...seekArgs,
    "-i",
    opts.sourceFile,
    ...(opts.maxSeconds ? ["-t", String(opts.maxSeconds)] : []),
    "-vf",
    `scale=${W}:${H},fps=${fps}`,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ], { windowsHide: true });

  let rec: Record<string, ort.Tensor> = {};
  let frameIndex = 0;
  let buffer = Buffer.alloc(0);
  let processing = Promise.resolve();
  let totalFrames = 0;

  await new Promise<void>((resolvePromise, reject) => {
    let rejected = false;
    const fail = (err: Error) => {
      if (!rejected) {
        rejected = true;
        reject(err);
      }
    };
    extract.on("error", fail);
    extract.stderr.on("data", () => {
      /* swallowed; errors surface via close code */
    });

    extract.stdout.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= frameBytes) {
        const frame = buffer.subarray(0, frameBytes);
        buffer = buffer.subarray(frameBytes);
        totalFrames += 1;
        const index = ++frameIndex;
        processing = processing.then(async () => {
          try {
            const rgb = new Float32Array(frame.length);
            for (let i = 0; i < frame.length; i++) rgb[i] = frame[i]; // 0..255 (RVM fp32 export expects this)
            const feeds: Record<string, ort.Tensor> = {
              src: new ort.Tensor("float32", rgb, [1, 3, H, W]),
              downsample_ratio: new ort.Tensor("float32", [0.5]),
            };
            for (const rn of REC_NAMES) {
              feeds[rn] = rec[rn] ?? new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]);
            }
            const out = await session.run(feeds);
            for (let i = 0; i < REC_NAMES.length; i++) rec[REC_NAMES[i]] = out[REC_OUT_NAMES[i]];
            const pha = out.pha.data as Float32Array;
            const pgi = Buffer.alloc(W * H);
            for (let i = 0; i < pgi.length; i++) pgi[i] = Math.round(Math.min(1, Math.max(0, pha[i])) * 255);
            await fs.writeFile(
              join(opts.masksDir, `mask_${String(index).padStart(5, "0")}.pgm`),
              Buffer.concat([Buffer.from(`P5\n${W} ${H}\n255\n`), pgi])
            );
            opts.onProgress?.(index, -1);
          } catch (err) {
            throw err;
          }
        }).catch((err) => {
          // Surface upstream: kill the ffmpeg child and reject the outer promise.
          try {
            extract.kill("SIGKILL");
          } catch {
            /* ignore */
          }
          rejected = true;
          reject(err);
        });
      }
    });

    extract.on("close", (code: number) => {
      processing.then(() => {
        if (code !== 0 && !rejected) {
          rejected = true;
          reject(new Error(`Frame extraction failed (code ${code}).`));
          return;
        }
        resolvePromise();
      });
    });
  });

  if (frameIndex === 0) {
    throw new Error("Background removal produced no frames.");
  }

  return {
    frameCount: frameIndex,
    width: W,
    height: H,
    fps,
    trimmedSeconds: totalFrames / fps,
  };
}

/** Cleanup masks after rendering. */
export async function cleanupMasks(masksDir: string): Promise<void> {
  try {
    await fs.rm(masksDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

export async function ensureModelDownloaded(): Promise<boolean> {
  if (bgRemovalAvailable()) return true;
  try {
    const { mkdirSync } = await import("fs");
    const { dirname } = await import("path");
    mkdirSync(dirname(MODEL_PATH), { recursive: true });
    const res = await fetch(MODEL_URL);
    if (!res.ok || !res.body) return false;
    const file = await import("fs");
    const { Readable } = await import("stream");
    const out = createWriteStream(MODEL_PATH);
    await new Promise<void>((resolvePromise, reject) => {
      Readable.fromWeb(res.body as never).pipe(out);
      out.on("finish", resolvePromise);
      out.on("error", reject);
    });
    logger.info("bg_model_downloaded", { size: (await fs.stat(MODEL_PATH)).size });
    return bgRemovalAvailable();
  } catch (err) {
    logger.warn("bg_model_download_failed", { error: String(err) });
    return false;
  }
}

export function maskSequencePattern(masksDir: string): string {
  return join(masksDir, "mask_%05d.pgm").replace(/\\/g, "/");
}

export function listExistingMasks(masksDir: string): string[] {
  try {
    return readdirSync(masksDir).filter((f) => f.endsWith(".pgm")).sort();
  } catch {
    return [];
  }
}
