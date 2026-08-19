/**
 * Professional showcase edit — hand-tuned cinematic motion spec.
 *
 * Renders smoke-src.mp4 (320x640, 5s) as a "pro editor" cut:
 *   cuts + slow-mo(0.5x) + fast(1.4x) + xfade,
 *   camera push/pull + punch-in + beat pulse + impact shake,
 *   slam / kinetic-rise3d / flip 3D text with extrusion + perspective,
 *   glow + letterbox + vignette + grain + white flash,
 *   trails, parallax subject composite, beat-synced SFX + ducking.
 *
 * Run: npx tsx scripts/showcase-edit.ts
 */
import { join, resolve } from "path";
import { existsSync, statSync } from "fs";
import { editVideoForPublish, probeVideo } from "../lib/editor";
import type { EditSpec } from "../lib/editor-spec";
import type { MotionSpec } from "../lib/motion/types";

const src = resolve(process.cwd(), "smoke-src.mp4");

const motion: MotionSpec = {
  enabled: true,
  style: "modern-cinematic",
  intensity: "smart",
  camera: [
    { t: 0, panX: 0.08, panY: 0, zoom: 1.12 },
    { t: 1.0, panX: -0.06, panY: 0, zoom: 1.02 },
    { t: 2.6, panX: 0, panY: 0, zoom: 1.06 },
    { t: 4.5, panX: -0.04, panY: 0, zoom: 1.18 },
  ],
  beats: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5],
  beatPulse: 0.05,
  shake: { at: [2.0, 4.0], strength: 0.12 },
  punchIn: { at: 2.0, strength: 0.25 },
  speedRamps: [
    { start: 1.0, end: 2.0, factor: 0.5 },
    { start: 2.0, end: 3.4, factor: 1.4 },
  ],
  transitions: { xfade: true, flashAt: [] },
  overlays: {
    glow: { strength: 0.2, color: "#ffffff" },
    rays: null,
    particles: null,
    flashes: [{ at: 2.0, color: "white" }],
    vignette: 0.5,
    letterbox: true,
    grain: 0.15,
  },
  trails: 2,
  parallax: 0.22,
  text3d: {
    t0: { depth: 5, rotateX: 0, rotateY: 9, entrance: "slam", kinetic: false, follow: false, behind: false, accent: true },
    t1: { depth: 4, rotateX: 6, rotateY: 0, entrance: "rise3d", kinetic: true, follow: false, behind: false, accent: true },
    t2: { depth: 6, rotateX: 0, rotateY: 8, entrance: "flip", kinetic: false, follow: false, behind: false, accent: true },
  },
  needsSubject: true,
  subjectTrack: null,
};

const spec: EditSpec = {
  trim: { start: 0, end: 5 },
  filter: "cinematic",
  customFilter: { brightness: 0.02, contrast: 0.08, saturation: 0.1, hue: 0, vignette: 0, blur: 0 },
  texts: [
    { id: "t0", text: "CREATE. POST. REPEAT.", fontSize: 54, color: "#ffffff", strokeColor: "#000000", y: 16, animation: "pop", startSec: 0.35, endSec: 5 },
    { id: "t1", text: "Your story, cinematic cut.", fontSize: 42, color: "#ffffff", strokeColor: "#000000", y: 70, animation: "slide-up", startSec: 1.6, endSec: 5 },
    { id: "t2", text: "STAY FOR THE END", fontSize: 58, color: "#ffffff", strokeColor: "#000000", y: 24, animation: "fade-in", startSec: 3.6, endSec: 5 },
  ],
  music: null,
  background: { remove: false, style: "blur", blurAmount: 30, color: "#111827" },
  audio: { noiseReduction: true, deesser: true, ducking: true, highpass: true, loudnessTarget: -14 },
  sfx: [
    { at: 0.35, type: "whoosh", volume: 0.4 },
    { at: 1.6, type: "whoosh", volume: 0.35 },
    { at: 2.0, type: "impact", volume: 0.5 },
    { at: 2.6, type: "riser", volume: 0.3 },
    { at: 3.6, type: "whoosh", volume: 0.4 },
    { at: 4.4, type: "impact", volume: 0.45 },
  ],
  motion,
};

async function main(): Promise<void> {
  if (!existsSync(src)) throw new Error(`Missing ${src}`);
  console.log("Rendering professional showcase edit…");
  const result = await editVideoForPublish({
    workspaceId: "showcase",
    driveFileId: "showcase",
    hookText: "",
    sourceFileOverride: src,
    spec,
    preview: true,
    onStage: (s, pct) => console.log(`  [stage ${s}${pct != null ? ` ${Math.round(pct * 100)}%` : ""}]`),
  });

  const probe = await probeVideo(result.filePath);
  console.log(`OUTPUT: ${result.filePath}`);
  console.log(`  size=${(statSync(result.filePath).size / 1024 / 1024).toFixed(1)}MB`);
  console.log(`  duration=${(probe.durationMs / 1000).toFixed(2)}s (expected ${(result.durationMs / 1000).toFixed(2)}s)`);
  console.log(`  ${probe.width}x${probe.height} ${probe.fps}fps audio=${probe.hasAudio}`);
  if (Math.abs(probe.durationMs - result.durationMs) > 400) {
    throw new Error(`Duration drift too large: ${probe.durationMs}ms vs ${result.durationMs}ms`);
  }
  console.log("PASS — showcase rendered.");
}

main().catch((err) => {
  console.error("FAIL:", err instanceof Error ? err.message.split("\n")[0] : err);
  process.exit(1);
});