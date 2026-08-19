/**
 * End-to-end smoke test for the AI Shorts Post-Production Engine.
 * Generates a synthetic test video (with speech-like tone bursts, silence
 * gaps and motion), runs the full pipeline: signal analysis → edit plan →
 * ffmpeg render (cuts, captions, SFX, music, audio engineering, loop) →
 * quality control. Reports PASS/FAIL per check.
 *
 * Run: npx tsx scripts/smoke-ai-edit.ts
 */

import { spawn } from "child_process";
import { promises as fs, createWriteStream } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import ffmpegPath from "ffmpeg-static";
import { editVideoForPublish, cleanupEditedFile, probeVideo } from "@/lib/editor";
import { analyzeSignal } from "@/lib/ai-edit/analysis";
import { buildEditPlan } from "@/lib/ai-edit/plan";
import { runQualityControl } from "@/lib/ai-edit/qc";

const ff = (args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("no ffmpeg"));
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (c: Buffer) => (err += c.toString()));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-400)))));
    p.on("error", reject);
  });

async function makeTestVideo(dir: string, variant: "talk" | "action"): Promise<string> {
  const vFile = join(dir, "raw_v.mp4");
  const aFile = join(dir, "raw_a.wav");
  const out = join(dir, "source.mp4");

  // Video: color segments with motion (scene changes), 15s, 720x1280 @30.
  const colors = variant === "action" ? ["red", "blue", "green", "orange", "purple"] : ["0x202020", "0x303030", "0x202020", "0x353535"];
  const vArgs = ["-y", "-f", "lavfi", "-i", `testsrc2=size=720x1280:rate=30:duration=15`];
  await ff(vArgs.concat(["-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", vFile]));

  // Audio: tone bursts separated by silence (talk variant has 0.8s gaps).
  const gap = variant === "talk" ? 1.0 : 0.25;
  const tones = variant === "action" ? ["180", "240", "300"] : ["440", "550", "660", "440"];
  const inputs: string[] = ["-y"];
  const chain: string[] = [];
  for (let i = 0; i < tones.length; i++) {
    inputs.push("-f", "lavfi", "-i", `sine=frequency=${tones[i]}:duration=1.6`);
    chain.push(`[${i}:a]`);
    if (i < tones.length - 1) {
      inputs.push("-f", "lavfi", "-i", `anullsrc=r=44100:cl=mono:duration=${gap}`);
      chain.push(`[${tones.length + i}:a]`);
    }
  }
  await ff(inputs.concat(["-filter_complex", `${chain.join("")}concat=n=${chain.length}:v=0:a=1`, "-c:a", "pcm_s16le", aFile]));

  await ff(["-y", "-i", vFile, "-i", aFile, "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", out]);
  return out;
}

let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const dir = await fs.mkdtemp(join(tmpdir(), "arp-smoke-"));
  try {
    for (const variant of ["talk", "action"] as const) {
      console.log(`\n=== ${variant} ===`);
      const source = await makeTestVideo(dir, variant);
      const signal = await analyzeSignal(source);
      check("signal analysis", signal.durationSec > 10, `dur=${signal.durationSec.toFixed(1)}s`);
      check("speech windows detected", signal.speech.length >= 2, `${signal.speech.length} windows`);
      check("silence detected", signal.silence.length >= 1, `${signal.silence.length} gaps`);

      const action = variant === "talk" ? "auto" : "create-loop";
      const intensity = variant === "talk" ? "smart" : "aggressive";
      const plan = await buildEditPlan({
        signal,
        fileName: `${variant}.mp4`,
        hookText: variant === "talk" ? "Three rules for better habits" : "Daily motivation",
        action,
        intensity,
        seed: "smoke",
      });
      console.log(`plan: ${plan.videoType} | ${plan.spec.filter} | cuts=${plan.spec.cuts?.length ?? 0} | sfx=${plan.spec.sfx?.length ?? 0} | texts=${plan.spec.texts?.length ?? 0} | loop=${plan.spec.loop} | score=${plan.score.overall}`);
      check("plan has spec", !!plan.spec);
      check("explainable changes", plan.changes.length > 0, `${plan.changes.length} changes`);

      const result = await editVideoForPublish({
        workspaceId: "smoke",
        driveFileId: "smoke",
        hookText: "Smoke test",
        durationMs: signal.durationSec * 1000,
        spec: plan.spec,
        preview: true,
        sourceFileOverride: source,
      }).catch(async (err: Error) => {
        const m = err.message.match(/filter_complex(?:[^\n]*)\n?([\s\S]{0,2000})/);
        const first = err.message.split("\n")[0];
        if (/code \d+/.test(first)) {
          const match = err.message.match(/filter_complex;[\s\S]*?\n?([\s\S]*)/);
          console.log("FILTER COMPLEX:", match ? match[1].slice(0, 1500) : "(not in message)");
        }
        throw err;
      });
      const probe = await probeVideo(result.filePath);
      check("render succeeded", result.filePath.length > 0);
      check("output dimensions", probe.width === 540 && probe.height === 960, `${probe.width}x${probe.height}`);
      check("output duration sane", probe.durationMs / 1000 >= 4, `${(probe.durationMs / 1000).toFixed(1)}s`);

      const issues = await runQualityControl({
        filePath: result.filePath,
        expectedDurationSec: signal.durationSec,
        loopExpected: plan.spec.loop === true,
      });
      check("quality control clean", issues.length === 0, issues.map((i) => i.message).join(" | ") || "no issues");
      await cleanupEditedFile(result.filePath);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  console.log(failures === 0 ? "\nALL SMOKE CHECKS PASSED" : `\n${failures} SMOKE CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(1);
});