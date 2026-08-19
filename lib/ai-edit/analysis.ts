import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { probeVideo } from "@/lib/editor";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/utils";
import type { SignalAnalysis } from "@/lib/ai-edit/types";

/**
 * Signal-level analysis of a downloaded video file using ffmpeg filters:
 * silence/speech windows, scene changes, black frames, brightness, loudness,
 * frozen frames and loop potential. Every measurement is fallback-safe —
 * analysis NEVER throws so editing always continues.
 */

const RUN_TIMEOUT_MS = 90_000;

function runFfmpeg(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not found.");
  const binary: string = ffmpegPath;
  return new Promise((resolvePromise, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc = spawn(binary, args, { windowsHide: true }) as any;
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    const timeout = setTimeout(() => proc.kill("SIGKILL"), RUN_TIMEOUT_MS);
    proc.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.on("close", (code: number) => {
      clearTimeout(timeout);
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
  });
}

interface Segment {
  start: number;
  end: number;
}

function parseTimes(text: string, marker: string): number[] {
  const out: number[] = [];
  const re = new RegExp(`${marker}:\\s*([\\d.]+)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(Number(m[1]));
  return out;
}

function mergeSegments(raw: Segment[], minGap = 0.25): Segment[] {
  const sorted = [...raw].sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && s.start - prev.end <= minGap) {
      prev.end = Math.max(prev.end, s.end);
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/** Complement of silence = speech/energy windows. */
function speechWindows(silence: Segment[], durationSec: number): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  for (const s of silence) {
    if (s.start > cursor + 0.05) out.push({ start: cursor, end: Math.min(s.start, durationSec) });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < durationSec - 0.05) out.push({ start: cursor, end: durationSec });
  return out.filter((s) => s.end - s.start >= 0.2);
}

async function detectSilence(file: string): Promise<Segment[]> {
  const { stderr } = await runFfmpeg([
    "-hide_banner", "-loglevel", "info",
    "-i", file,
    "-af", "silencedetect=noise=-35dB:d=0.35",
    "-f", "null", "-",
  ]);
  const starts = parseTimes(stderr, "silence_start");
  const ends = parseTimes(stderr, "silence_end");
  const segs: Segment[] = [];
  for (let i = 0; i < Math.max(starts.length, ends.length); i++) {
    const start = starts[i] ?? 0;
    const end = ends[i] ?? start + 0.35;
    if (end > start) segs.push({ start, end });
  }
  return mergeSegments(segs);
}

async function detectSceneChanges(file: string): Promise<number[]> {
  const { stdout, stderr } = await runFfmpeg([
    "-hide_banner", "-loglevel", "info",
    "-i", file,
    "-vf", "select='gt(scene,0.32)',showinfo",
    "-f", "null", "-",
  ]);
  const text = stdout + stderr;
  return parseTimes(text, "pts_time").filter((t) => t > 0.05);
}

async function detectBlack(file: string): Promise<Segment[]> {
  const { stderr } = await runFfmpeg([
    "-hide_banner", "-loglevel", "info",
    "-i", file,
    "-vf", "blackdetect=d=0.35:pix_th=0.12",
    "-f", "null", "-",
  ]);
  const starts = parseTimes(stderr, "black_start");
  const ends = parseTimes(stderr, "black_end");
  const segs: Segment[] = [];
  for (let i = 0; i < Math.max(starts.length, ends.length); i++) {
    const start = starts[i] ?? 0;
    const end = ends[i] ?? start + 0.35;
    if (end > start) segs.push({ start, end });
  }
  return mergeSegments(segs, 0.1);
}

async function sampleBrightness(file: string, durationSec: number): Promise<number> {
  const every = Math.max(1, Math.round(durationSec / 8)); // ~8 samples
  const { stdout } = await runFfmpeg([
    "-hide_banner", "-loglevel", "error",
    "-i", file,
    "-vf", `select='eq(mod(n,${Math.max(1, Math.round(every * 30))}),0)',signalstats,metadata=print:file=-`,
    "-an", "-f", "null", "-",
  ]);
  const values = stdout
    .split("\n")
    .filter((l) => l.includes("lavfi.signalstats.YAVG="))
    .map((l) => Number(l.split("=")[1]))
    .filter((v) => isFinite(v));
  if (!values.length) return 0.5;
  return values.reduce((a, b) => a + b, 0) / values.length / 255;
}

async function detectLoudness(file: string): Promise<SignalAnalysis["loudness"]> {
  try {
    const { stderr } = await runFfmpeg([
      "-hide_banner", "-loglevel", "info",
      "-i", file,
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
      "-f", "null", "-",
    ]);
    const start = stderr.indexOf("{");
    const end = stderr.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    const json = JSON.parse(stderr.slice(start, end + 1)) as {
      input_i?: string;
      input_tp?: string;
      input_lra?: string;
    };
    return {
      inputI: Number(json.input_i ?? 0),
      inputTp: Number(json.input_tp ?? 0),
      inputLra: Number(json.input_lra ?? 0),
    };
  } catch {
    return null;
  }
}

/** Mean absolute difference between two raw RGB buffers (0..255). */
function meanAbsDiff(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 255;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n;
}

async function extractRawFrame(file: string, atSec: number, w: number, h: number): Promise<Buffer> {
  const { code, stdout, stderr } = await runFfmpeg([
    "-hide_banner", "-loglevel", "error",
    "-ss", atSec.toFixed(3),
    "-i", file,
    "-frames:v", "1",
    "-vf", `scale=${w}:${h},format=rgb24`,
    "-f", "rawvideo",
    "pipe:1",
  ]);
  if (code !== 0) throw new Error(stderr.slice(0, 120));
  return Buffer.from(stdout, "latin1");
}

async function detectLoopScore(file: string, durationSec: number): Promise<number> {
  try {
    if (durationSec < 1) return 0.1;
    const w = 48;
    const h = 48;
    const first = await extractRawFrame(file, Math.min(0.05, durationSec / 2), w, h);
    const last = await extractRawFrame(file, Math.max(0, durationSec - 0.15), w, h);
    const middle = await extractRawFrame(file, Math.min(durationSec / 2, durationSec - 0.15), w, h);
    const dFL = meanAbsDiff(first, last);
    const dFM = meanAbsDiff(first, middle);
    // Similarity of the seam, normalized against the video's own variance.
    const sim = Math.max(0, 1 - dFL / 128);
    const variance = Math.max(0.04, dFM / 255);
    let score = (sim - 0.5) / (0.5 * (1 - variance * 0.6));
    if (variance < 0.08) score = Math.min(score, 0.45); // static video: low value loop
    return Math.max(0, Math.min(1, score));
  } catch {
    return 0;
  }
}

async function detectFrozenFrames(file: string, fps: number): Promise<number> {
  try {
    const step = Math.max(1, Math.round(fps));
    const { stdout } = await runFfmpeg([
      "-hide_banner", "-loglevel", "error",
      "-i", file,
      "-vf", `select='eq(mod(n,${step}),0)',framemd5`,
      "-f", "null", "-",
    ]);
    const md5s = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("md5="))
      .map((l) => l.split("md5=")[1]);
    let frozen = 0;
    for (let i = 1; i < md5s.length; i++) {
      if (md5s[i] === md5s[i - 1]) frozen += 1;
    }
    return frozen;
  } catch {
    return 0;
  }
}

/**
 * Run the full signal analysis on a local video file. Never throws —
 * any failed measurement falls back to a neutral default.
 */
export async function analyzeSignal(file: string): Promise<SignalAnalysis> {
  const empty: SignalAnalysis = {
    durationSec: 0,
    width: 1080,
    height: 1920,
    fps: 30,
    orientation: "portrait",
    hasAudio: false,
    silence: [],
    speech: [],
    sceneChanges: [],
    black: [],
    brightness: 0.5,
    voiceDensity: 0,
    loudness: null,
    loopScore: 0,
    frozenFrames: 0,
    cutRate: 0,
  };
  try {
    const probe = await probeVideo(file);
    const durationSec = probe.durationMs / 1000;
    const orientation: SignalAnalysis["orientation"] =
      probe.height > probe.width * 1.05
        ? "portrait"
        : probe.width > probe.height * 1.05
          ? "landscape"
          : "square";
    const out: SignalAnalysis = {
      ...empty,
      durationSec,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      orientation,
      hasAudio: probe.hasAudio,
    };

    const [silence, sceneChanges, black, loudness, loopScore, brightness, frozen] =
      await Promise.allSettled([
        probe.hasAudio ? detectSilence(file) : Promise.resolve<Segment[]>([]),
        detectSceneChanges(file),
        detectBlack(file),
        probe.hasAudio ? detectLoudness(file) : Promise.resolve<SignalAnalysis["loudness"]>(null),
        detectLoopScore(file, durationSec),
        sampleBrightness(file, durationSec),
        detectFrozenFrames(file, probe.fps),
      ]);

    out.silence = silence.status === "fulfilled" ? silence.value : [];
    out.speech = speechWindows(out.silence, durationSec);
    out.sceneChanges = sceneChanges.status === "fulfilled" ? sceneChanges.value : [];
    out.black = black.status === "fulfilled" ? black.value : [];
    out.loudness = loudness.status === "fulfilled" ? loudness.value : null;
    out.loopScore = loopScore.status === "fulfilled" ? loopScore.value : 0;
    out.brightness = brightness.status === "fulfilled" ? brightness.value : 0.5;
    out.frozenFrames = frozen.status === "fulfilled" ? frozen.value : 0;
    out.cutRate = durationSec > 0 ? out.sceneChanges.length / durationSec : 0;

    const voiced = out.speech.reduce((a, s) => a + (s.end - s.start), 0);
    out.voiceDensity = durationSec > 0 ? Math.min(1, voiced / durationSec) : 0;

    return out;
  } catch (err) {
    logger.warn("signal_analysis_failed", { error: getErrorMessage(err) });
    return empty;
  }
}