import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import * as ort from "onnxruntime-node";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/utils";
import { getRvmSession, probeFps } from "@/lib/bg-removal";
import type { BeatInfo, MotionAnalysis, MotionEnergy, SubjectTrack } from "@/lib/motion/types";

/**
 * Motion Graphics analysis: music beat detection, frame-to-frame motion
 * energy, and full-subject tracking (the WHOLE person, not just the face —
 * RVM alpha mattes at small resolution). Every measurement is fallback-safe:
 * analysis never throws, so editing always continues.
 */

const RUN_TIMEOUT_MS = 120_000;
const PCM_RATE = 16_000;
const PCM_WINDOW = 512; // 32 ms analysis windows
const MIN_BEAT_GAP = 0.28; // ~214 BPM max

function runFfmpeg(args: string[]): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not found.");
  const binary: string = ffmpegPath;
  return new Promise((resolvePromise, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc = spawn(binary, args, { windowsHide: true }) as any;
    const chunks: Buffer[] = [];
    let stderr = "";
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    const timeout = setTimeout(() => proc.kill("SIGKILL"), RUN_TIMEOUT_MS);
    proc.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.on("close", (code: number) => {
      clearTimeout(timeout);
      resolvePromise({ code: code ?? -1, stdout: Buffer.concat(chunks), stderr });
    });
  });
}

/** Read the full audio as mono 16 kHz s16le PCM. */
async function readPcm(file: string, maxSeconds?: number): Promise<Buffer | null> {
  try {
    const args = [
      "-hide_banner", "-loglevel", "error",
      "-i", file,
      "-vn", "-ac", "1", "-ar", String(PCM_RATE), "-f", "s16le",
    ];
    if (maxSeconds) args.push("-t", String(maxSeconds));
    args.push("pipe:1");
    const { code, stdout } = await runFfmpeg(args);
    if (code !== 0 || stdout.length < PCM_WINDOW * 2) return null;
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Energy-based beat detection with adaptive thresholding and a minimum
 * inter-beat gap. Returns beat times and a BPM estimate. Falls back to a
 * flat grid (120 BPM) with confident=false when no grid is detectable.
 */
export function detectBeatsFromPcm(pcm: Buffer, sampleRate = PCM_RATE): BeatInfo {
  const window = PCM_WINDOW;
  const hop = Math.round(sampleRate * 0.02); // 20 ms hop
  const energies: number[] = [];
  const nSamples = pcm.length / 2;
  for (let i = 0; i + window * 2 <= pcm.length; i += hop * 2) {
    let sum = 0;
    for (let j = 0; j < window; j++) {
      const v = pcm.readInt16LE(i + j * 2) / 32768;
      sum += v * v;
    }
    energies.push(Math.sqrt(sum / window));
  }
  if (energies.length < 8) {
    return { beats: [], bpm: 0, confident: false };
  }
  const hopSec = hop / sampleRate;
  const tOf = (i: number) => i * hopSec;

  // Smooth with a small moving average.
  const smooth: number[] = energies.map((_, i) => {
    const from = Math.max(0, i - 2);
    const to = Math.min(energies.length, i + 3);
    let s = 0;
    for (let k = from; k < to; k++) s += energies[k];
    return s / (to - from);
  });

  const mean = smooth.reduce((a, b) => a + b, 0) / smooth.length;
  const variance = smooth.reduce((a, b) => a + (b - mean) * (b - mean), 0) / smooth.length;
  const std = Math.sqrt(variance);
  const threshold = Math.max(mean * 1.35, mean + std * 1.25);

  // Adaptive local threshold: a peak must exceed the surrounding mean too.
  const beats: number[] = [];
  for (let i = 3; i < smooth.length - 3; i++) {
    const v = smooth[i];
    if (v <= threshold) continue;
    const local = (smooth[i - 3] + smooth[i - 2] + smooth[i - 1] + smooth[i + 1] + smooth[i + 2] + smooth[i + 3]) / 6;
    if (v < local * 1.18) continue;
    const t = tOf(i);
    if (beats.length && t - beats[beats.length - 1] < MIN_BEAT_GAP) {
      const lastIdx = Math.round((beats[beats.length - 1]) / hopSec);
      if (lastIdx >= 0 && lastIdx < smooth.length && v > smooth[lastIdx]) beats[beats.length - 1] = t;
      continue;
    }
    beats.push(t);
  }

  let bpm = 0;
  let confident = false;
  if (beats.length >= 5) {
    const intervals: number[] = [];
    for (let i = 1; i < beats.length; i++) {
      const d = beats[i] - beats[i - 1];
      if (d >= 0.24 && d <= 2.2) intervals.push(d);
    }
    if (intervals.length >= 4) {
      const sorted = [...intervals].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const medianAbsDev =
        sorted.reduce((a, d) => a + Math.abs(d - median), 0) / sorted.length;
      // Tight interval spread = a real rhythm grid.
      if (medianAbsDev / median < 0.35) {
        bpm = Math.round(60 / median);
        confident = true;
      }
    }
  }
  return { beats, bpm, confident };
}

/**
 * Beat detection on a local file. Returns a fallback 120 BPM grid when the
 * audio has no clear rhythm (so beat-synced features stay usable).
 */
export async function detectBeats(file: string, opts?: { maxSeconds?: number }): Promise<BeatInfo> {
  try {
    const pcm = await readPcm(file, opts?.maxSeconds);
    if (!pcm) return { beats: [], bpm: 0, confident: false };
    const info = detectBeatsFromPcm(pcm);
    if (info.confident && info.beats.length >= 2) return info;
    // Weak/no grid: provide a neutral grid so features degrade gracefully.
    const durationSec = opts?.maxSeconds ?? info.beats.length * 0.5 + 10;
    const grid: number[] = [];
    for (let t = 0.5; t < durationSec; t += 0.5) grid.push(t);
    return { beats: info.confident ? info.beats : grid, bpm: info.bpm || 120, confident: info.confident };
  } catch (err) {
    logger.warn("beat_detection_failed", { error: getErrorMessage(err) });
    return { beats: [], bpm: 0, confident: false };
  }
}

/**
 * Frame-to-frame motion energy: absolute difference per frame (tblend),
 * measured as mean luma via signalstats, grouped into time windows.
 */
export async function measureMotionEnergy(file: string, opts?: { maxSeconds?: number }): Promise<MotionEnergy> {
  const empty: MotionEnergy = { windowSec: 0.5, samples: [], avg: 0 };
  try {
    const args = [
      "-hide_banner", "-loglevel", "error",
      "-i", file,
      "-vf", "tblend=all_mode=difference,signalstats,metadata=print:file=-",
      "-an", "-f", "null", "-",
    ];
    if (opts?.maxSeconds) args.splice(2, 0, "-t", String(opts.maxSeconds));
    const { code, stdout, stderr } = await runFfmpeg(args);
    if (code !== 0) return empty;
    const text = stdout.toString() + stderr;
    const values: number[] = [];
    for (const line of text.split("\n")) {
      const m = line.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
      if (m) values.push(Number(m[1]) / 255);
    }
    if (values.length < 2) return empty;
    const fps = values.length / Math.max(1, opts?.maxSeconds ?? values.length / 30);
    const windowSec = 0.5;
    const perWindow = Math.max(1, Math.round(windowSec * fps));
    const samples: MotionEnergy["samples"] = [];
    for (let i = 0; i + perWindow <= values.length; i += perWindow) {
      let sum = 0;
      for (let j = 0; j < perWindow; j++) sum += values[i + j];
      samples.push({ t: (i / fps) + windowSec / 2, energy: sum / perWindow });
    }
    const avg = samples.reduce((a, s) => a + s.energy, 0) / Math.max(1, samples.length);
    return { windowSec, samples, avg };
  } catch (err) {
    logger.warn("motion_energy_failed", { error: getErrorMessage(err) });
    return empty;
  }
}

/**
 * Full-subject tracking using the RVM matting model at a small resolution
 * (fast, ~25ms/frame). Computes the subject's bounding box + centroid over
 * time from the alpha matte — the whole person, not just the face.
 */
export async function trackSubject(file: string, opts?: { maxSeconds?: number }): Promise<SubjectTrack> {
  const empty: SubjectTrack = { available: false, samples: [] };
  if (!ffmpegPath) return empty;
  try {
    const session = await getRvmSession();
    const fps = await probeFps(file);
    const W = 144;
    const H = 256;
    const frameBytes = W * H * 3;
    const seekArgs: string[] = [];
    const extract = spawn(ffmpegPath, [
      "-hide_banner", "-loglevel", "error",
      ...seekArgs,
      "-i", file,
      ...(opts?.maxSeconds ? ["-t", String(opts.maxSeconds)] : []),
      "-vf", `scale=${W}:${H},fps=${Math.min(15, fps)}`,
      "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
    ], { windowsHide: true });

    const recNames = ["r1i", "r2i", "r3i", "r4i"];
    const recOutNames = ["r1o", "r2o", "r3o", "r4o"];
    let rec: Record<string, ort.Tensor> = {};
    let buffer = Buffer.alloc(0);
    let frameIndex = 0;
    const rawSamples: { t: number; cx: number; cy: number; w: number; h: number; present: number }[] = [];
    let processing = Promise.resolve();
    let trackFps = Math.min(15, fps);

    await new Promise<void>((resolvePromise, reject) => {
      let rejected = false;
      const fail = (err: Error) => {
        if (!rejected) {
          rejected = true;
          reject(err);
        }
      };
      extract.on("error", fail);
      extract.stderr.on("data", () => {});

      extract.stdout.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= frameBytes) {
          const frame = buffer.subarray(0, frameBytes);
          buffer = buffer.subarray(frameBytes);
          const index = ++frameIndex;
          processing = processing
            .then(async () => {
              const rgb = new Float32Array(frame.length);
              for (let i = 0; i < frame.length; i++) rgb[i] = frame[i];
              const feeds: Record<string, ort.Tensor> = {
                src: new ort.Tensor("float32", rgb, [1, 3, H, W]),
                downsample_ratio: new ort.Tensor("float32", [0.25]),
              };
              for (const rn of recNames) {
                feeds[rn] = rec[rn] ?? new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]);
              }
              const out = await session.run(feeds);
              for (let i = 0; i < recNames.length; i++) rec[recOutNames[i]] = out[recOutNames[i]];
              const pha = out.pha.data as Float32Array;
              // Bounding box from alpha > 0.5.
              let minX = W, minY = H, maxX = -1, maxY = -1, sumX = 0, sumY = 0, count = 0;
              for (let y = 0; y < H; y++) {
                const row = y * W;
                for (let x = 0; x < W; x++) {
                  const a = pha[row + x];
                  if (a > 0.5) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    sumX += x;
                    sumY += y;
                    count++;
                  }
                }
              }
              if (count > 0) {
                rawSamples.push({
                  t: index / trackFps,
                  cx: sumX / count / W,
                  cy: sumY / count / H,
                  w: (maxX - minX + 1) / W,
                  h: (maxY - minY + 1) / H,
                  present: Math.min(1, count / (W * H * 0.35)),
                });
              }
            })
            .catch((err: Error) => {
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
          if (code !== 0 && !rejected && rawSamples.length === 0) {
            rejected = true;
            reject(new Error(`Subject tracking extraction failed (code ${code}).`));
            return;
          }
          resolvePromise();
        });
      });
    });

    if (rawSamples.length < 3) return empty;

    // Downsample to ~4 samples/sec and median-smooth for stable tracking.
    const outFps = 4;
    const bucket = Math.max(1, Math.round(trackFps / outFps));
    const smoothed: SubjectTrack["samples"] = [];
    const median = (vals: number[]) => [...vals].sort((a, b) => a - b)[Math.floor(vals.length / 2)];
    for (let i = 0; i < rawSamples.length; i += bucket) {
      const group = rawSamples.slice(i, i + bucket);
      if (!group.length) continue;
      smoothed.push({
        t: group[Math.floor(group.length / 2)].t,
        cx: median(group.map((s) => s.cx)),
        cy: median(group.map((s) => s.cy)),
        w: median(group.map((s) => s.w)),
        h: median(group.map((s) => s.h)),
        present: median(group.map((s) => s.present)),
      });
    }
    // Fill small gaps (subject occasionally vanishes) by linear interpolation.
    const filled: SubjectTrack["samples"] = [];
    for (let i = 0; i < smoothed.length; i++) {
      filled.push(smoothed[i]);
      if (i + 1 < smoothed.length && smoothed[i + 1].t - smoothed[i].t > 1.5) {
        const mid = {
          t: (smoothed[i].t + smoothed[i + 1].t) / 2,
          cx: (smoothed[i].cx + smoothed[i + 1].cx) / 2,
          cy: (smoothed[i].cy + smoothed[i + 1].cy) / 2,
          w: (smoothed[i].w + smoothed[i + 1].w) / 2,
          h: (smoothed[i].h + smoothed[i + 1].h) / 2,
          present: (smoothed[i].present + smoothed[i + 1].present) / 2,
        };
        filled.push(mid);
      }
    }
    filled.sort((a, b) => a.t - b.t);
    return { available: true, samples: filled };
  } catch (err) {
    logger.warn("subject_tracking_failed", { error: getErrorMessage(err) });
    return empty;
  }
}

/**
 * Run the full motion analysis (beats + motion energy + subject track) in
 * parallel. Never throws — every part falls back to a neutral default.
 */
export async function analyzeMotion(file: string, opts?: { maxSeconds?: number }): Promise<MotionAnalysis> {
  try {
    const [beats, motion, subject] = await Promise.allSettled([
      detectBeats(file, opts),
      measureMotionEnergy(file, opts),
      trackSubject(file, opts),
    ]);
    const beatInfo = beats.status === "fulfilled" ? beats.value : { beats: [], bpm: 0, confident: false };
    const musicDriven =
      beatInfo.confident && beatInfo.beats.length >= 3 && (beatInfo.bpm >= 80 && beatInfo.bpm <= 190);
    return {
      beats: beatInfo,
      motion: motion.status === "fulfilled" ? motion.value : { windowSec: 0.5, samples: [], avg: 0 },
      subject: subject.status === "fulfilled" ? subject.value : { available: false, samples: [] },
      musicDriven,
    };
  } catch (err) {
    logger.warn("motion_analysis_failed", { error: getErrorMessage(err) });
    return {
      beats: { beats: [], bpm: 0, confident: false },
      motion: { windowSec: 0.5, samples: [], avg: 0 },
      subject: { available: false, samples: [] },
      musicDriven: false,
    };
  }
}

export { readPcm };