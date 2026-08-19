import type { SfxType } from "@/lib/editor-spec";

/**
 * Motion Graphics & Effects Engine — spec types.
 *
 * The engine analyses each short (music beats, motion energy, full-subject
 * tracking) and the AI "selector" (lib/motion/select.ts) produces a
 * MotionSpec that is stored on the video and rendered deterministically by
 * lib/motion/render.ts + lib/editor.ts.
 *
 * Default style: Modern + Cinematic + High Retention + Clean 3D Motion
 * Graphics. Restraint rule: every element must serve hook, pacing, clarity
 * or visual impact — effects are never applied for their own sake.
 */

export type MotionStyleKey = "modern-cinematic" | "dynamic-punchy" | "clean-minimal" | "energetic-pop";

/** Same scale as the AI-edit engine so intensity stays consistent. */
export type MotionIntensity = "subtle" | "smart" | "aggressive";

/** Easing used between camera keyframes (cubic basis is always smooth). */
export interface MotionKeyframe {
  /** Seconds on the FINAL timeline. */
  t: number;
  /** 1..1.6 — camera scale. 1 = full frame, >1 = push-in. */
  zoom: number;
  /** -1..1 — virtual horizontal pan (only visible while zoom > 1). */
  panX: number;
  /** -1..1 — virtual vertical pan. */
  panY: number;
}

export interface MotionOverlays {
  /** Cinematic letterbox bars (top/bottom ~10%). */
  letterbox: boolean;
  /** 0..1 film grain strength. */
  grain: number;
  /** Soft cinematic glow (screen-blended blurred copy). */
  glow: { strength: number; color: string } | null;
  /** Animated light rays sweeping the frame. */
  rays: { strength: number } | null;
  /** Particles: dust (film) or spark (pop). */
  particles: { kind: "dust" | "spark"; density: number; color: string } | null;
  /** Full-screen flashes (white/black) used as transitions + impacts. */
  flashes: { at: number; color: "white" | "black" }[];
  /** Extra vignette on top of the grade (0..1). */
  vignette: number;
}

/** 3D treatment per text overlay (keyed by TextOverlay.id). */
export interface MotionText3D {
  /** Extrusion depth (stacked darker copies) 0..8. */
  depth: number;
  /** Static plane tilt in degrees (perspective). 0..12. */
  rotateX: number;
  /** Static plane skew in degrees. 0..12. */
  rotateY: number;
  /** Entrance animation. */
  entrance: "slam" | "flip" | "rise3d" | "spin" | "fade" | "none";
  /** Word-by-word kinetic typography reveal (staggered prefixes). */
  kinetic: boolean;
  /** The text follows the tracked subject (motion tracking). */
  follow: boolean;
  /** Render behind the subject (requires subject masks). */
  behind: boolean;
  /** Keyword emphasis accent rendering. */
  accent: boolean;
}

export interface MotionSpeedRamp {
  /** Final-timeline window. */
  start: number;
  end: number;
  /** <1 = slow-mo, >1 = fast-forward. 0.4..1.6 */
  factor: number;
}

export interface MotionSpec {
  enabled: boolean;
  style: MotionStyleKey;
  intensity: MotionIntensity;
  /** Eased camera path (smooth cubic basis). */
  camera: MotionKeyframe[];
  /** Detected beat times (final timeline) used for beat-synced pulses. */
  beats: number[];
  /** 0..1 — zoom pulse on detected music beats. */
  beatPulse: number;
  /** Impact shake events (decaying sine bursts). */
  shake: { at: number[]; strength: number };
  /** Punch-in: fast zoom spike + shake at an impact moment. */
  punchIn: { at: number; strength: number } | null;
  /** Beat-synced speed ramps (slow-mo/fast) on the final timeline. */
  speedRamps: MotionSpeedRamp[];
  /** Segment transitions. xfade between cut pieces, flash at times. */
  transitions: { xfade: boolean; flashAt: number[] } | null;
  overlays: MotionOverlays;
  /** Motion trails (tmix ghosting), 0 = off. */
  trails: number;
  /** 0..1 background/subject depth separation (needs subject masks). */
  parallax: number;
  /** Per-text 3D treatment. */
  text3d: Record<string, MotionText3D>;
  /** True when the render needs RVM subject masks. */
  needsSubject: boolean;
  /** Subject tracking samples (final timeline) for follow/text-layering. */
  subjectTrack?: SubjectTrackSample[] | null;
}

/** Signal-level motion facts measured from the actual file. */
export interface BeatInfo {
  /** Beat times in source seconds. */
  beats: number[];
  bpm: number;
  /** True when a real percussive grid was detected (vs. a default grid). */
  confident: boolean;
}

export interface MotionEnergySample {
  t: number;
  energy: number;
}

export interface MotionEnergy {
  windowSec: number;
  samples: MotionEnergySample[];
  avg: number;
}

export interface SubjectTrackSample {
  t: number;
  /** Normalized subject center (0..1 of the frame). */
  cx: number;
  cy: number;
  /** Normalized subject size (0..1). */
  w: number;
  h: number;
  /** 0..1 — how much of the frame is subject. */
  present: number;
}

export interface SubjectTrack {
  available: boolean;
  samples: SubjectTrackSample[];
}

export interface MotionAnalysis {
  beats: BeatInfo;
  motion: MotionEnergy;
  subject: SubjectTrack;
  /** True when the music is rhythm-driven (usable beat grid). */
  musicDriven: boolean;
}

/** Everything the AI selector needs to make a design. */
export interface MotionDesignInput {
  analysis: MotionAnalysis;
  /** Signal analysis from lib/ai-edit/analysis.ts. */
  signal: {
    durationSec: number;
    cutRate: number;
    hasAudio: boolean;
    sceneChanges: number[];
    voiceDensity: number;
    brightness: number;
  };
  videoType: string;
  aiAnalysis?: { style?: string; topic?: string; visualNotes?: string; hook?: string } | null;
  intensity: MotionIntensity;
  /** User style override (null = AI picks). */
  style?: MotionStyleKey | null;
  /** The texts the design will animate (captions + hook). */
  texts: { id: string; text: string; startSec: number | null }[];
  durationSec: number;
  seed: string;
  /** Keep the existing motion untouched (targeted actions). */
  preserve?: boolean;
  /** User explicitly asked for an automatic design. */
  force?: boolean;
  /**
   * Cut timeline (source → final mapping). When present, beat times and
   * subject-track samples are remapped to the final timeline so rendered
   * effects stay in sync with the cut edit.
   */
  timeline?: { segments: { start: number; end: number }[]; finalDuration: number } | null;
}

/** The design the selector produces, ready to store + render. */
export interface MotionDesignResult {
  spec: MotionSpec;
  /** Human-readable reasons (shown in the UI). */
  changes: { what: string; why: string }[];
  notes: string[];
  /** Beat/text-synced SFX to merge into the edit (Text + SFX sync). */
  sfx: { at: number; type: SfxType; volume: number }[];
}

export const MOTION_STYLE_LABELS: Record<MotionStyleKey, string> = {
  "modern-cinematic": "Modern + Cinematic",
  "dynamic-punchy": "Dynamic + Punchy",
  "clean-minimal": "Clean + Minimal",
  "energetic-pop": "Energetic Pop",
};

export const MOTION_STYLE_DESCRIPTIONS: Record<MotionStyleKey, string> = {
  "modern-cinematic":
    "Clean 3D motion graphics, smooth eased camera, cinematic grade, subtle glow and depth. High retention without noise.",
  "dynamic-punchy":
    "Punch-ins, impact shakes, beat-synced speed ramps, motion trails and dust particles. Built for action content.",
  "clean-minimal":
    "Almost invisible: slow drift, kinetic captions only. The content is the star.",
  "energetic-pop":
    "Beat pulses, slam text, sparks, flashes and spin accents. Bright, snappy, trend-forward.",
};

export const ENTRANCE_LABELS: Record<MotionText3D["entrance"], string> = {
  slam: "Slam",
  flip: "3D flip",
  rise3d: "Rise (3D)",
  spin: "Spin",
  fade: "Soft fade",
  none: "Static",
};

export function defaultMotionSpec(): MotionSpec {
  return {
    enabled: false,
    style: "modern-cinematic",
    intensity: "smart",
    beats: [],
    camera: [
      { t: 0, zoom: 1, panX: 0, panY: 0 },
      { t: 2.5, zoom: 1.05, panX: 0, panY: 0 },
    ],
    beatPulse: 0,
    shake: { at: [], strength: 0 },
    punchIn: null,
    speedRamps: [],
    transitions: null,
    overlays: {
      letterbox: false,
      grain: 0,
      glow: null,
      rays: null,
      particles: null,
      flashes: [],
      vignette: 0,
    },
    trails: 0,
    parallax: 0,
    text3d: {},
    needsSubject: false,
  };
}
