import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { probeVideo } from "@/lib/editor";
import { logger } from "@/lib/logger";
import type { QcIssue } from "@/lib/ai-edit/score";

/**
 * Automatic quality control: re-analyzes the RENDERED file and reports
 * concrete problems (clipping, loudness, black frames, frozen frames,
 * duration drift, loop seams). The pipeline uses these to decide whether
 * the edit needs a revision (max 3).
 */

const RUN_TIMEOUT_MS = 60_000;

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

export async function runQualityControl(opts: {
  filePath: string;
  expectedDurationSec: number;
  loopExpected: boolean;
}): Promise<QcIssue[]> {
  const issues: QcIssue[] = [];
  try {
    const probe = await probeVideo(opts.filePath);
    const actual = probe.durationMs / 1000;
    if (Math.abs(actual - opts.expectedDurationSec) > 1.5) {
      issues.push({
        severity: "major",
        message: `Rendered duration ${actual.toFixed(1)}s differs from plan ${opts.expectedDurationSec.toFixed(1)}s`,
      });
    }

    // Black frames in the middle (a fade-in at 0 is fine).
    const blackRes = await runFfmpeg([
      "-hide_banner", "-loglevel", "info",
      "-i", opts.filePath,
      "-vf", "blackdetect=d=0.4:pix_th=0.1",
      "-an", "-f", "null", "-",
    ]);
    const blackStarts = [...blackRes.stderr.matchAll(/black_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    const blackEnds = [...blackRes.stderr.matchAll(/black_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    for (let i = 0; i < blackStarts.length; i++) {
      const start = blackStarts[i];
      const end = blackEnds[i] ?? start + 0.4;
      if (start > 0.2 && end < actual - 0.2) {
        issues.push({
          severity: "major",
          message: `Unexpected black frames at ${start.toFixed(1)}s-${end.toFixed(1)}s`,
        });
      }
    }

    // Audio: clipping + loudness.
    if (probe.hasAudio) {
      const astats = await runFfmpeg([
        "-hide_banner", "-loglevel", "info",
        "-i", opts.filePath,
        "-af", "astats=metadata=1:reset=0",
        "-f", "null", "-",
      ]);
      const clipMatch = astats.stderr.match(/Clipping samples:\s*([\d.]+)/);
      const clipCount = clipMatch ? Number(clipMatch[1]) : 0;
      if (clipCount > 200) {
        issues.push({
          severity: "major",
          message: `Audio clipping detected (${Math.round(clipCount)} samples)`,
        });
      }
      const loud = await runFfmpeg([
        "-hide_banner", "-loglevel", "info",
        "-i", opts.filePath,
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
        "-f", "null", "-",
      ]);
      const jsonStart = loud.stderr.indexOf("{");
      const jsonEnd = loud.stderr.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        try {
          const parsed = JSON.parse(loud.stderr.slice(jsonStart, jsonEnd + 1)) as { input_i?: string; input_tp?: string };
          const i = Number(parsed.input_i ?? 0);
          if (i > -10 || i < -26) {
            issues.push({
              severity: "minor",
              message: `Output loudness ${i.toFixed(1)} LUFS outside the -26..-10 band`,
            });
          }
        } catch {
          // unparseable — ignore
        }
      }
    }

    // Frozen frames.
    const fps = probe.fps || 30;
    const freeze = await runFfmpeg([
      "-hide_banner", "-loglevel", "error",
      "-i", opts.filePath,
      "-vf", `select='eq(mod(n,${Math.max(1, Math.round(fps))}),0)',framemd5`,
      "-f", "null", "-",
    ]);
    const md5s = freeze.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("md5="))
      .map((l) => l.split("md5=")[1]);
    let frozen = 0;
    for (let i = 1; i < md5s.length; i++) {
      if (md5s[i] === md5s[i - 1]) frozen += 1;
    }
    if (frozen >= 6 && actual > 15) {
      issues.push({ severity: "minor", message: `${frozen} frozen frame samples detected` });
    }

    // Loop seam: hard cut at the very end (loop should crossfade).
    if (opts.loopExpected) {
      const seam = await runFfmpeg([
        "-hide_banner", "-loglevel", "info",
        "-i", opts.filePath,
        "-vf", `select='gte(t,${Math.max(0, actual - 1.2)})',signalstats,metadata=print:file=-`,
        "-an", "-f", "null", "-",
      ]);
      const yavgs = (seam.stdout + seam.stderr)
        .split("\n")
        .filter((l) => l.includes("lavfi.signalstats.YAVG="))
        .map((l) => Number(l.split("=")[1]));
      if (yavgs.length >= 2) {
        const last = yavgs[yavgs.length - 1];
        const avg = yavgs.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, yavgs.length - 1);
        if (last < avg * 0.35) {
          issues.push({
            severity: "minor",
            message: "Loop seam dips toward black at the end",
          });
        }
      }
    }
  } catch (err) {
    logger.warn("qc_failed", { error: String(err) });
    issues.push({ severity: "major", message: "Quality control could not analyze the render" });
  }
  return issues;
}