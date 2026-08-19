import { createWriteStream, mkdtempSync, promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { streamVideoFromDrive } from "@/lib/storage";
import { editVideoForPublish, cleanupEditedFile } from "@/lib/editor";
import { analyzeVideoFrames } from "@/lib/ai";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/utils";
import { analyzeSignal } from "@/lib/ai-edit/analysis";
import { buildEditPlan } from "@/lib/ai-edit/plan";
import { runQualityControl } from "@/lib/ai-edit/qc";
import { applyQcPenalty } from "@/lib/ai-edit/score";
import { analyzeMotion } from "@/lib/motion/analyze";
import { pieceFinalDuration, specToPieces } from "@/lib/motion/render";
import type { AiEditOptions, AiEditPlan, AiEditResult } from "@/lib/ai-edit/types";
import type { EditSpec } from "@/lib/editor-spec";

/**
 * The AI Shorts Post-Production Engine pipeline:
 *
 *   download → analyze (signal + optional vision) → understand (video type)
 *   → edit plan (hook/cuts/pacing/audio/sfx/color/captions/ending/loop)
 *   → render → quality control → revise (max 3) → final render → score
 *
 * The rendered preview file belongs to the caller (cleanupEditedFile).
 */

const MAX_REVISIONS = 3;

async function downloadSource(opts: AiEditOptions, tempDir: string): Promise<string> {
  const sourceFile = join(tempDir, "source.mp4");
  const driveStream = await streamVideoFromDrive(opts.workspaceId, opts.driveFileId);
  await new Promise<void>((resolvePromise, reject) => {
    const out = createWriteStream(sourceFile);
    driveStream.on("error", reject);
    out.on("error", reject);
    out.on("finish", resolvePromise);
    driveStream.pipe(out);
  });
  return sourceFile;
}

/** Extract a few small JPEG frames from the LOCAL file for vision analysis. */
async function extractLocalFrames(file: string, count = 3): Promise<{ mimeType: string; base64: string }[]> {
  if (!ffmpegPath) return [];
  const binary: string = ffmpegPath;
  return new Promise((resolvePromise) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc = spawn(binary, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      file,
      "-vf",
      `thumbnail=${Math.max(20, Math.floor(300 / count))},scale=384:-2`,
      "-frames:v",
      String(count),
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ], { windowsHide: true }) as any;
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.on("close", (code: number) => {
      if (code !== 0 || !chunks.length) {
        resolvePromise([]);
        return;
      }
      const stream = Buffer.concat(chunks);
      const jpegs: Buffer[] = [];
      let start = 0;
      for (let i = 0; i + 2 < stream.length; i++) {
        if (stream[i] === 0xff && stream[i + 1] === 0xd8 && stream[i + 2] === 0xff) {
          if (i > start) jpegs.push(stream.subarray(start, i));
          start = i;
        }
      }
      if (start < stream.length) jpegs.push(stream.subarray(start));
      resolvePromise(
        jpegs.slice(0, count).map((j) => ({ mimeType: "image/jpeg", base64: j.toString("base64") }))
      );
    });
    proc.on("error", () => resolvePromise([]));
  });
}

/**
 * Run the full AI edit pipeline. Returns the plan (with the final spec,
 * explanation and score) and a rendered preview file (if requested).
 */
export async function runAiEdit(opts: AiEditOptions): Promise<AiEditResult> {
  const stage = (s: string, label: string, pct?: number) => opts.onStage?.(s, label, pct);
  let tempDir: string | null = null;
  let previewPath: string | null = null;
  const revisionLimit = Math.max(1, Math.min(MAX_REVISIONS, opts.revisionLimit ?? MAX_REVISIONS));

  try {
    // 1. Download.
    stage("download", "Downloading video from Drive…");
    tempDir = mkdtempSync(join(tmpdir(), "arp-ai-edit-"));
    const sourceFile = await downloadSource(opts, tempDir);

    // 2. Signal analysis.
    stage("analyze", "Analyzing video (silence, scenes, motion, audio)…");
    const signal = await analyzeSignal(sourceFile);
    stage("analyze", "Understanding the content…", 60);

    // 3. Vision analysis (optional, when AI is configured).
    let aiAnalysis = opts.aiAnalysis ?? null;
    try {
      if (!aiAnalysis) {
        const frames = await extractLocalFrames(sourceFile, 3);
        if (frames.length) {
          aiAnalysis = await analyzeVideoFrames({
            fileName: opts.fileName,
            durationMs: signal.durationSec * 1000,
            frames,
          });
        }
      }
    } catch (err) {
      logger.warn("ai_vision_analysis_failed", { error: getErrorMessage(err) });
      aiAnalysis = null;
    }

    // 3b. Motion analysis (beats, motion energy, subject track) — feeds the
    //     Motion Graphics & Effects engine. Never fatal when it fails.
    let motionAnalysis = null;
    try {
      stage("analyze", "Detecting beats and tracking the subject…", 85);
      motionAnalysis = await analyzeMotion(sourceFile, { maxSeconds: opts.maxSeconds });
    } catch (err) {
      logger.warn("ai_motion_analysis_failed", { error: getErrorMessage(err) });
      motionAnalysis = null;
    }

    // 4. Build the edit plan.
    stage("plan", "Creating the edit plan…");
    let plan: AiEditPlan = await buildEditPlan({
      signal,
      fileName: opts.fileName,
      hookText: opts.hookText,
      aiAnalysis,
      action: opts.action,
      intensity: opts.intensity,
      currentSpec: opts.currentSpec,
      seed: `${opts.fileName}|${opts.action}|${opts.intensity}`,
      motionAnalysis,
    });

    // 5. Render preview.
    let spec = plan.spec;
    const render = async (): Promise<string> => {
      const result = await editVideoForPublish({
        workspaceId: opts.workspaceId,
        driveFileId: opts.driveFileId,
        hookText: opts.hookText,
        durationMs: signal.durationSec * 1000,
        spec,
        preview: true,
        maxSeconds: opts.maxSeconds,
        onStage: (s, pct) => {
          const labels: Record<string, string> = {
            download: "Downloading video from Drive…",
            "bg-removal": "Removing background (AI person cut-out)…",
            edit: "Applying the AI edit (effects, audio, SFX, captions)…",
            done: "Encoding…",
          };
          stage(s, labels[s] ?? "Processing…", pct);
        },
      });
      return result.filePath;
    };

    stage("render", "Rendering the AI edit…");
    if (previewPath) await cleanupEditedFile(previewPath).catch(() => {});
    previewPath = await render();

    // 6. Quality control + revisions.
    const expectedDurationSec = computeExpectedDuration(plan.spec, signal.durationSec);
    let issues = await runQualityControl({
      filePath: previewPath,
      expectedDurationSec,
      loopExpected: plan.looped,
    });
    let revisions = 0;
    while (issues.length && revisions < revisionLimit) {
      revisions += 1;
      stage("qc", `Quality check found issues — revising (${revisions}/${revisionLimit})…`);
      const applied: string[] = [];
      let stop = false;
      for (const issue of issues) {
        if (/clip/i.test(issue.message) && spec.music?.track) {
          spec = { ...spec, music: { ...spec.music, volume: Math.max(0.04, (spec.music.volume ?? 0.18) * 0.7) } };
          applied.push("lowered music volume to stop clipping");
        } else if (/black/i.test(issue.message)) {
          spec = { ...spec, effects: [], filter: "none" };
          applied.push("removed heavy effects causing black frames");
        } else if (/loudness/i.test(issue.message) && spec.audio) {
          const cur = spec.audio.loudnessTarget ?? -14;
          spec = { ...spec, audio: { ...spec.audio, loudnessTarget: Math.min(-10, cur + 2) } };
          applied.push("re-targeted loudness");
        } else if (/loop/i.test(issue.message) && spec.loop) {
          spec = { ...spec, loop: false };
          applied.push("dropped the loop (seam was unnatural)");
        } else if (/duration/i.test(issue.message)) {
          // Length is enforced by the renderer (`-t`); drift here is a
          // measurement/rounding artifact — nothing to revise, stop the loop.
          stop = true;
        }
      }
      if (stop || !applied.length) {
        // Duration drift is accepted; otherwise nothing actionable.
        break;
      }
      if (previewPath) await cleanupEditedFile(previewPath).catch(() => {});
      previewPath = await render();
      issues = await runQualityControl({
        filePath: previewPath,
        expectedDurationSec,
        loopExpected: spec.loop === true,
      });
    }
    plan = {
      ...plan,
      spec,
      revisions,
      score: applyQcPenalty(plan.score, issues),
      summary:
        plan.summary +
        (revisions
          ? ` Auto-fixed after review: ${Array.from(new Set(issues.map((i) => i.message))).join("; ")}.`
          : ""),
    };
    if (issues.length && revisions >= revisionLimit) {
      plan.analysisNotes.push("Rendered with minor remaining issues after max revision attempts.");
    }

    stage("done", "AI edit complete.");
    return { plan, preview: { filePath: previewPath } };
  } catch (err) {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    logger.error("ai_edit_failed", { workspaceId: opts.workspaceId, error: getErrorMessage(err) });
    throw err;
  }
}

/**
 * The duration the renderer should produce for a given spec:
 * cuts sum → trim window → source duration, scaled by pacing.
 */
function computeExpectedDuration(spec: EditSpec, sourceDurationSec: number): number {
  let d: number;
  if (spec.motion?.enabled && spec.motion.speedRamps.length) {
    const pieces = specToPieces(spec, spec.motion, sourceDurationSec);
    if (pieces.length) {
      d = pieces.reduce((sum: number, p) => sum + pieceFinalDuration(p), 0);
      if (spec.pacing) d = d / spec.pacing;
      return Math.max(1, d);
    }
  }
  if (spec.cuts?.length) {
    d = spec.cuts.reduce((sum: number, c: { start: number; end: number }) => sum + Math.max(0, c.end - c.start), 0);
  } else if (spec.trim?.start != null) {
    d = Math.max(0, (spec.trim.end ?? sourceDurationSec) - spec.trim.start);
  } else {
    d = sourceDurationSec;
  }
  if (spec.pacing) d = d / spec.pacing;
  return Math.max(1, d);
}