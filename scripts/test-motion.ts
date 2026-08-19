/**
 * Motion Graphics & Effects engine — smoke test.
 *
 * Renders smoke-src.mp4 through the full motion pipeline:
 *   analyzeMotion (beats/energy/subject) → createMotionDesign → editor render.
 *
 * Run: npm run test:motion
 */
import { join, resolve } from "path";
import { existsSync, statSync } from "fs";
import { analyzeMotion } from "../lib/motion/analyze";
import { createMotionDesign } from "../lib/motion/select";
import { editVideoForPublish, probeVideo } from "../lib/editor";
import type { EditSpec } from "../lib/editor-spec";

async function main(): Promise<void> {
  const src = resolve(process.cwd(), "smoke-src.mp4");
  if (!existsSync(src)) throw new Error(`Missing ${src} — generate it with scripts/make-smoke-src.ts`);

  console.log("1/4 Analyzing motion (beats, energy, subject track)…");
  const analysis = await analyzeMotion(src, { maxSeconds: 10 });
  console.log(
    `  beats=${analysis.beats.beats.length} bpm=${analysis.beats.bpm} confident=${analysis.beats.confident}` +
      ` | subject=${analysis.subject.available ? `${analysis.subject.samples.length} samples` : "none"}` +
      ` | musicDriven=${analysis.musicDriven}`
  );

  console.log("2/4 Designing motion (AI selector)…");
  const design = createMotionDesign({
    analysis,
    signal: {
      durationSec: 5,
      cutRate: 0.4,
      hasAudio: analysis.beats.beats.length > 0,
      sceneChanges: [],
      voiceDensity: 0,
      brightness: 0.5,
    },
    videoType: "motivational",
    intensity: "smart",
    texts: [
      { id: "c0", text: "Motion graphics engine online", startSec: 0.2 },
      { id: "c1", text: "3D kinetic text + beats", startSec: 1.6 },
    ],
    durationSec: 5,
    seed: "smoke-test",
  });
  console.log(`  enabled=${design.spec.enabled} style=${design.spec.style} intensity=${design.spec.intensity}`);
  console.log(`  camera=${design.spec.camera.length}kfs beats=${design.spec.beats.length} ramps=${design.spec.speedRamps.length}`);
  console.log(`  text3d=${Object.keys(design.spec.text3d).length} trails=${design.spec.trails} parallax=${design.spec.parallax}`);
  design.changes.forEach((c) => console.log(`  - ${c.what}`));
  if (!design.spec.enabled) {
    console.log("  DESIGN SKIPPED — nothing to render.");
    return;
  }

  console.log("3/4 Rendering (preview 540x960)…");
  const spec: EditSpec = {
    trim: { start: 0, end: 5 },
    filter: "cinematic",
    customFilter: { brightness: 0, contrast: 0.06, saturation: 0.08, hue: 0, vignette: 0, blur: 0 },
    texts: [
      { id: "c0", text: "Motion graphics engine online", fontSize: 52, color: "#ffffff", strokeColor: "#000000", y: 24, animation: "pop", startSec: 0.2, endSec: 2.2 },
      { id: "c1", text: "3D kinetic text + beats", fontSize: 46, color: "#ffffff", strokeColor: "#000000", y: 72, animation: "pop", startSec: 1.6, endSec: 5 },
    ],
    music: null,
    audio: {
      noiseReduction: true,
      deesser: false,
      ducking: false,
      highpass: true,
      loudnessTarget: -14,
    },
    motion: design.spec,
  };
  const result = await editVideoForPublish({
    workspaceId: "smoke",
    driveFileId: "smoke",
    hookText: "",
    sourceFileOverride: src,
    spec,
    preview: true,
    onStage: (s, pct) => console.log(`  [stage ${s}${pct != null ? ` ${Math.round(pct * 100)}%` : ""}]`),
  });

  console.log("4/4 Verifying output…");
  const probe = await probeVideo(result.filePath);
  console.log(`  ${result.filePath}`);
  console.log(`  size=${(statSync(result.filePath).size / 1024 / 1024).toFixed(1)}MB`);
  console.log(`  duration=${(probe.durationMs / 1000).toFixed(2)}s (expected ${(result.durationMs / 1000).toFixed(2)}s)`);
  console.log(`  ${probe.width}x${probe.height} ${probe.fps}fps audio=${probe.hasAudio}`);
  if (Math.abs(probe.durationMs - result.durationMs) > 400) {
    throw new Error(`Duration drift too large: ${probe.durationMs}ms vs ${result.durationMs}ms`);
  }
  console.log("PASS — motion engine rendered end-to-end.");
}

main().catch((err) => {
  console.error("FAIL:", err instanceof Error ? err.message : err);
  process.exit(1);
});