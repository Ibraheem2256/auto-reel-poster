/**
 * Per-video editing specification. Stored as JSON on the Video model and
 * applied at render/publish time by lib/editor.ts.
 *
 * A `null` spec (or missing fields) means "use the legacy defaults"
 * (9:16 crop + hook + fades + random CC0 music).
 */

import type { MotionSpec } from "@/lib/motion/types";
import { defaultMotionSpec, MOTION_STYLE_LABELS, ENTRANCE_LABELS } from "@/lib/motion/types";

export type FilterPresetKey =
  | "none"
  | "vivid"
  | "noir"
  | "vintage"
  | "warm"
  | "cool"
  | "cinematic"
  | "dreamy";

export type EffectKey = "zoom-intro" | "ken-burns" | "shake" | "bounce";

export type TextAnimation = "none" | "fade-in" | "slide-up" | "pop";

/** Synthesized sound effects — generated locally, zero copyright. */
export type SfxType =
  | "whoosh"
  | "impact"
  | "hit"
  | "boom"
  | "riser"
  | "drop"
  | "click"
  | "pop"
  | "swipe"
  | "glitch";

export interface SfxEvent {
  at: number; // seconds in the FINAL timeline
  type: SfxType;
  volume: number; // 0..1
}

/** Automatic audio engineering settings (applied at render time). */
export interface AudioEnhance {
  noiseReduction: boolean; // afftdn — hiss/room noise
  deesser: boolean; // deesser — harsh sibilance
  ducking: boolean; // music ducks under voice
  highpass: boolean; // remove low rumble below ~80 Hz
  loudnessTarget: number; // LUFS (typically -14)
  /**
   * Speech windows (absolute source seconds) used to build the duck envelope.
   * Music is pulled down while speech is present; when omitted the duck is a
   * constant mild attenuation (manual specs without analysis).
   */
  duckWindows?: { startSec: number; endSec: number }[] | null;
}

/** A kept segment of the video (smart cutting). Absolute source seconds. */
export interface CutSegment {
  start: number;
  end: number;
}

export interface TextOverlay {
  id: string;
  text: string;
  fontSize: number; // 24..96 (final 1080x1920 canvas)
  color: string; // hex
  strokeColor: string; // hex
  y: number; // vertical position in % of height (5..95)
  animation: TextAnimation;
  startSec: number | null; // null = from the beginning
  endSec: number | null; // null = until the end
  /** Words within `text` rendered in an accent color (keyword emphasis). */
  emphasis?: string[];
}

export interface EditSpec {
  trim?: { start: number; end: number | null } | null; // seconds
  filter?: FilterPresetKey | null;
  customFilter?: {
    brightness: number; // -1..1, 0 = neutral
    contrast: number; // -1..1, 0 = neutral
    saturation: number; // -1..1, 0 = neutral
    hue: number; // -180..180 degrees
    vignette: number; // 0..1
    blur: number; // 0..8 sigma
  } | null;
  effects?: EffectKey[];
  texts?: TextOverlay[];
  music?: { track: string | null; volume: number; fadeInSec: number; fadeOutSec: number } | null;
  background?: {
    remove: boolean; // real person cut-out (RVM)
    style: "blur" | "color";
    color: string; // hex
    blurAmount: number; // 4..60
  } | null;
  progressBar?: boolean; // animated accent bar at the bottom
  /** Smart cutting: kept segments (absolute source seconds). */
  cuts?: CutSegment[] | null;
  /** Synthesized sound effects placed on the final timeline. */
  sfx?: SfxEvent[] | null;
  /** Automatic audio engineering. */
  audio?: AudioEnhance | null;
  /** Seamless loop: the ending crossfades back into the beginning. */
  loop?: boolean;
  /** Global pace multiplier (>1 faster). Applied via setpts/atempo. */
  pacing?: number;
  /** AI Motion Graphics & Effects engine spec (see lib/motion). */
  motion?: MotionSpec | null;
  createdAt?: string;
  updatedAt?: string;
}

export const FILTER_PRESETS: Record<FilterPresetKey, string[]> = {
  none: [],
  vivid: ["eq=saturation=1.45:contrast=1.12:brightness=0.01"],
  noir: ["hue=s=0", "eq=contrast=1.25:brightness=0.02"],
  vintage: [
    "colorbalance=rs=0.18:gs=0.03:bs=-0.12",
    "eq=saturation=0.85:contrast=1.05",
    "noise=alls=7:allf=t",
    "vignette=PI/5",
  ],
  warm: ["colorbalance=rs=0.12:gs=0.02:bs=-0.12", "eq=saturation=1.12"],
  cool: ["colorbalance=rs=-0.12:gs=0.01:bs=0.12", "eq=saturation=1.05"],
  cinematic: ["eq=contrast=1.18:brightness=-0.03:saturation=1.22", "vignette=PI/4"],
  dreamy: ["gblur=sigma=1.2", "eq=saturation=1.15:brightness=0.02", "vignette=PI/5"],
};

export const FILTER_PRESET_LABELS: Record<FilterPresetKey, string> = {
  none: "Original",
  vivid: "Vivid",
  noir: "Noir",
  vintage: "Vintage",
  warm: "Warm",
  cool: "Cool",
  cinematic: "Cinematic",
  dreamy: "Dreamy",
};

export const EFFECT_LABELS: Record<EffectKey, string> = {
  "zoom-intro": "Zoom intro",
  "ken-burns": "Slow zoom",
  shake: "Shake",
  bounce: "Bounce",
};

export const TEXT_ANIMATION_LABELS: Record<TextAnimation, string> = {
  none: "Static",
  "fade-in": "Fade in",
  "slide-up": "Slide up",
  pop: "Pop",
};

export const SFX_LABELS: Record<SfxType, string> = {
  whoosh: "Whoosh",
  impact: "Impact",
  hit: "Hit",
  boom: "Cinematic boom",
  riser: "Riser",
  drop: "Drop",
  click: "Click",
  pop: "Pop",
  swipe: "Swipe",
  glitch: "Glitch",
};

export const DEFAULT_LOUDNESS_TARGET = -14;

export function defaultAudioEnhance(): AudioEnhance {
  return {
    noiseReduction: true,
    deesser: true,
    ducking: true,
    highpass: true,
    loudnessTarget: DEFAULT_LOUDNESS_TARGET,
  };
}

export function defaultEditSpec(): EditSpec {
  return {
    trim: { start: 0, end: null },
    filter: "none",
    customFilter: { brightness: 0, contrast: 0, saturation: 0, hue: 0, vignette: 0, blur: 0 },
    effects: ["zoom-intro"],
    texts: [],
    music: { track: null, volume: 0.22, fadeInSec: 1, fadeOutSec: 2 },
    background: { remove: false, style: "blur", color: "#111827", blurAmount: 40 },
    progressBar: false,
    cuts: null,
    sfx: null,
    audio: null,
    loop: false,
    pacing: 1,
    motion: null,
  };
}

export function normalizeEditSpec(input: unknown): EditSpec {
  const d = defaultEditSpec();
  if (!input || typeof input !== "object") return d;
  const s = input as Record<string, unknown>;

  const isHex = (v: unknown): v is string =>
    typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

  const trimRaw = s.trim as Record<string, unknown> | null | undefined;
  const trim = trimRaw && typeof trimRaw === "object" ? trimRaw : null;

  const filter = (s.filter as FilterPresetKey | null | undefined) ?? null;
  const filterKey: FilterPresetKey =
    filter && filter in FILTER_PRESETS ? filter : "none";

  const cf = (s.customFilter ?? null) as Record<string, unknown> | null;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && isFinite(v) ? v : fallback;

  const effectsRaw = Array.isArray(s.effects) ? s.effects : [];
  const effects = effectsRaw.filter((e): e is EffectKey => e in EFFECT_LABELS);

  const textsRaw = Array.isArray(s.texts) ? s.texts : [];
  const texts: TextOverlay[] = textsRaw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t) => ({
      id: typeof t.id === "string" ? t.id : `t-${Math.random().toString(36).slice(2, 8)}`,
      text: String(t.text ?? "").slice(0, 80),
      fontSize: Math.min(96, Math.max(24, num(t.fontSize, 54))),
      color: isHex(t.color) ? t.color : "#ffffff",
      strokeColor: isHex(t.strokeColor) ? t.strokeColor : "#000000",
      y: Math.min(95, Math.max(5, num(t.y, 12))),
      animation: (["none", "fade-in", "slide-up", "pop"].includes(String(t.animation))
        ? t.animation
        : "fade-in") as TextAnimation,
      startSec: t.startSec === null || t.startSec === undefined ? null : num(t.startSec, 0),
      endSec: t.endSec === null || t.endSec === undefined ? null : num(t.endSec, 0),
      emphasis: Array.isArray(t.emphasis)
        ? (t.emphasis as unknown[])
            .filter((w): w is string => typeof w === "string")
            .map((w) => w.trim().slice(0, 24))
            .filter(Boolean)
            .slice(0, 6)
        : undefined,
    }))
    .filter((t) => t.text.trim().length > 0);

  const musicRaw = (s.music ?? null) as Record<string, unknown> | null;
  const music = musicRaw && typeof musicRaw === "object" ? musicRaw : null;

  const bgRaw = (s.background ?? null) as Record<string, unknown> | null;
  const bg = bgRaw && typeof bgRaw === "object" ? bgRaw : null;

  const cutsRaw = Array.isArray(s.cuts) ? s.cuts : [];
  const cuts: CutSegment[] = cutsRaw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      start: Math.max(0, num(c.start, 0)),
      end: num(c.end, 0),
    }))
    .filter((c) => c.end - c.start >= 0.3)
    .sort((a, b) => a.start - b.start);

  const sfxRaw = Array.isArray(s.sfx) ? s.sfx : [];
  const sfx: SfxEvent[] = sfxRaw
    .filter(
      (e): e is Record<string, unknown> =>
        !!e &&
        typeof e === "object" &&
        typeof e.at === "number" &&
        isFinite(e.at) &&
        (e.at as number) >= 0 &&
        String(e.type) in SFX_LABELS
    )
    .map((e) => ({
      at: num(e.at, 0),
      type: e.type as SfxType,
      volume: Math.min(1, Math.max(0, num(e.volume, 0.5))),
    }))
    .sort((a, b) => a.at - b.at);

  const audioRaw = (s.audio ?? null) as Record<string, unknown> | null;
  const audio =
    audioRaw && typeof audioRaw === "object"
      ? {
          noiseReduction: audioRaw.noiseReduction !== false,
          deesser: audioRaw.deesser !== false,
          ducking: audioRaw.ducking !== false,
          highpass: audioRaw.highpass !== false,
          loudnessTarget: Math.min(-8, Math.max(-23, num(audioRaw.loudnessTarget, DEFAULT_LOUDNESS_TARGET))),
          duckWindows: Array.isArray(audioRaw.duckWindows)
            ? (audioRaw.duckWindows as { startSec?: number; endSec?: number }[])
                .filter(
                  (w): w is { startSec: number; endSec: number } =>
                    !!w && isFinite(num(w.startSec, NaN)) && isFinite(num(w.endSec, NaN)) && num(w.endSec, 0) > num(w.startSec, 0)
                )
                .map((w) => ({ startSec: num(w.startSec, 0), endSec: num(w.endSec, 0) }))
                .sort((a, b) => a.startSec - b.startSec)
            : null,
        }
      : null;

  const pacing = num(s.pacing, 1);
  const pace = Math.min(1.4, Math.max(0.7, pacing));

  // --- Motion Graphics & Effects engine. ---
  const motionRaw = (s.motion ?? null) as Record<string, unknown> | null;
  const motion = normalizeMotionSpec(motionRaw);

  return {
    trim:
      trim && num(trim.start, 0) >= 0
        ? {
            start: num(trim.start, 0),
            end: trim.end === null || trim.end === undefined ? null : num(trim.end, 0),
          }
        : null,
    filter: filterKey,
    customFilter: {
      brightness: num(cf?.brightness, 0),
      contrast: num(cf?.contrast, 0),
      saturation: num(cf?.saturation, 0),
      hue: num(cf?.hue, 0),
      vignette: num(cf?.vignette, 0),
      blur: num(cf?.blur, 0),
    },
    effects,
    texts,
    music:
      music && typeof music.track === "string"
        ? {
            track: music.track,
            volume: Math.min(1, Math.max(0, num(music.volume, 0.22))),
            fadeInSec: num(music.fadeInSec, 1),
            fadeOutSec: num(music.fadeOutSec, 2),
          }
        : null,
    background:
      bg && typeof bg.remove === "boolean"
        ? {
            remove: bg.remove,
            style: bg.style === "color" ? "color" : "blur",
            color: isHex(bg.color) ? bg.color : "#111827",
            blurAmount: Math.min(60, Math.max(4, num(bg.blurAmount, 40))),
          }
        : null,
    progressBar: s.progressBar === true,
    cuts: cuts.length ? cuts : null,
    sfx: sfx.length ? sfx : null,
    audio,
    loop: s.loop === true,
    pacing: pace !== 1 ? pace : 1,
    motion,
  };
}

// ---------------------------------------------------------------------------
// Motion Graphics & Effects engine spec normalization
// ---------------------------------------------------------------------------

const MOTION_STYLE_KEYS = Object.keys(MOTION_STYLE_LABELS) as MotionSpec["style"][];
const ENTRANCE_KEYS = Object.keys(ENTRANCE_LABELS) as MotionSpec["text3d"][string]["entrance"][];

/** Strictly normalize a MotionSpec (stored on the Video model + UI). */
export function normalizeMotionSpec(input: unknown): MotionSpec | null {
  if (!input || typeof input !== "object") return null;
  const s = input as Record<string, unknown>;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && isFinite(v) ? v : fallback;
  const isHex = (v: unknown): v is string =>
    typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
  const d = defaultMotionSpec();

  const enabled = s.enabled === true;
  if (!enabled) return null;

  const style = (MOTION_STYLE_KEYS as string[]).includes(String(s.style)) ? (s.style as MotionSpec["style"]) : d.style;
  const intensity = ["subtle", "smart", "aggressive"].includes(String(s.intensity))
    ? (s.intensity as MotionSpec["intensity"])
    : d.intensity;

  const cameraRaw = Array.isArray(s.camera) ? s.camera : [];
  const camera = (cameraRaw as Record<string, unknown>[])
    .filter((k): k is Record<string, unknown> => !!k && typeof k === "object")
    .map((k) => ({
      t: Math.max(0, num(k.t, 0)),
      zoom: Math.min(1.6, Math.max(1, num(k.zoom, 1))),
      panX: Math.min(1, Math.max(-1, num(k.panX, 0))),
      panY: Math.min(1, Math.max(-1, num(k.panY, 0))),
    }))
    .sort((a, b) => a.t - b.t)
    .slice(0, 12);
  if (!camera.length) camera.push(...d.camera);

  const beats = Array.isArray(s.beats)
    ? (s.beats as unknown[]).filter((b): b is number => typeof b === "number" && isFinite(b) && b >= 0).slice(0, 60)
    : [];

  const shakeAt = Array.isArray(s.shake)
    ? (s.shake as Record<string, unknown>[]).filter((e) => isFinite(num(e?.at, NaN)) && num(e?.at, 0) >= 0).map((e) => num(e.at, 0)).slice(0, 8)
    : [];
  const shakeStrength = num(s.shakeStrength, 0.2);

  const ramps = Array.isArray(s.speedRamps)
    ? (s.speedRamps as Record<string, unknown>[])
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        .map((r) => ({
          start: Math.max(0, num(r.start, 0)),
          end: num(r.end, 0),
          factor: Math.min(1.6, Math.max(0.4, num(r.factor, 0.5))),
        }))
        .filter((r) => r.end > r.start + 0.1)
        .slice(0, 4)
    : [];

  const punchRaw = (s.punchIn ?? null) as Record<string, unknown> | null;
  const punchIn =
    punchRaw && isFinite(num(punchRaw.at, NaN))
      ? { at: Math.max(0, num(punchRaw.at, 0)), strength: Math.min(0.5, Math.max(0, num(punchRaw.strength, 0.28))) }
      : null;

  const transitionsRaw = (s.transitions ?? null) as Record<string, unknown> | null;
  const transitions =
    transitionsRaw && typeof transitionsRaw === "object"
      ? {
          xfade: transitionsRaw.xfade === true,
          flashAt: Array.isArray(transitionsRaw.flashAt)
            ? (transitionsRaw.flashAt as unknown[])
                .filter((t): t is number => typeof t === "number" && isFinite(t) && t >= 0)
                .slice(0, 8)
            : [],
        }
      : null;

  const oRaw = (s.overlays ?? null) as Record<string, unknown> | null;
  const o = oRaw && typeof oRaw === "object" ? oRaw : {};
  const glowRaw = (o.glow ?? null) as Record<string, unknown> | null;
  const raysRaw = (o.rays ?? null) as Record<string, unknown> | null;
  const partRaw = (o.particles ?? null) as Record<string, unknown> | null;
  const flashes = Array.isArray(o.flashes)
    ? (o.flashes as Record<string, unknown>[])
        .filter((f) => isFinite(num(f?.at, NaN)))
        .map((f) => ({ at: Math.max(0, num(f.at, 0)), color: f.color === "black" ? ("black" as const) : ("white" as const) }))
        .slice(0, 8)
    : [];

  const text3dRaw = (s.text3d ?? null) as Record<string, unknown> | null;
  const text3d: MotionSpec["text3d"] = {};
  if (text3dRaw && typeof text3dRaw === "object") {
    for (const [id, tRaw] of Object.entries(text3dRaw)) {
      const t = (tRaw ?? {}) as Record<string, unknown>;
      if (!id || typeof tRaw !== "object" || tRaw === null) continue;
      text3d[id] = {
        depth: Math.min(8, Math.max(0, Math.round(num(t.depth, 0)))),
        rotateX: Math.min(12, Math.max(0, num(t.rotateX, 0))),
        rotateY: Math.min(12, Math.max(0, num(t.rotateY, 0))),
        entrance: (ENTRANCE_KEYS as string[]).includes(String(t.entrance))
          ? (t.entrance as MotionSpec["text3d"][string]["entrance"])
          : "fade",
        kinetic: t.kinetic === true,
        follow: t.follow === true,
        behind: t.behind === true,
        accent: t.accent !== false,
      };
    }
  }

  const needsSubject =
    s.needsSubject === true ||
    Object.values(text3d).some((t) => t.follow || t.behind) ||
    num(o.parallax ?? s.parallax, 0) > 0;

  const subjectTrackRaw = Array.isArray(s.subjectTrack) ? s.subjectTrack : [];
  const subjectTrack = subjectTrackRaw
    .filter((st): st is Record<string, unknown> => !!st && typeof st === "object")
    .map((st) => ({
      t: Math.max(0, num(st.t, 0)),
      cx: Math.min(1, Math.max(0, num(st.cx, 0.5))),
      cy: Math.min(1, Math.max(0, num(st.cy, 0.5))),
      w: Math.min(1, Math.max(0, num(st.w, 0.2))),
      h: Math.min(1, Math.max(0, num(st.h, 0.2))),
      present: Math.min(1, Math.max(0, num(st.present, 0.5))),
    }))
    .sort((a, b) => a.t - b.t)
    .slice(0, 400);

  const overlays: MotionSpec["overlays"] = {
    letterbox: o.letterbox === true,
    grain: Math.min(1, Math.max(0, num(o.grain, 0))),
    glow:
      glowRaw && isFinite(num(glowRaw.strength, NaN))
        ? { strength: Math.min(1, Math.max(0, num(glowRaw.strength, 0))), color: isHex(glowRaw.color) ? glowRaw.color : "#FFF3D6" }
        : null,
    rays: raysRaw && isFinite(num(raysRaw.strength, NaN)) ? { strength: Math.min(1, Math.max(0, num(raysRaw.strength, 0))) } : null,
    particles:
      partRaw && partRaw.kind && ["dust", "spark"].includes(String(partRaw.kind))
        ? {
            kind: partRaw.kind as "dust" | "spark",
            density: Math.min(1, Math.max(0, num(partRaw.density, 0.4))),
            color: isHex(partRaw.color) ? partRaw.color : "#ffffff",
          }
        : null,
    flashes,
    vignette: Math.min(1, Math.max(0, num(o.vignette, 0))),
  };

  return {
    enabled: true,
    style,
    intensity,
    beats,
    camera,
    beatPulse: Math.min(0.6, Math.max(0, num(s.beatPulse, 0))),
    shake: { at: shakeAt, strength: Math.min(0.6, Math.max(0, shakeStrength)) },
    punchIn,
    speedRamps: ramps,
    transitions,
    overlays,
    trails: Math.min(6, Math.max(0, Math.round(num(s.trails, 0)))),
    parallax: Math.min(1, Math.max(0, num(s.parallax ?? o.parallax, 0))),
    text3d,
    needsSubject,
    subjectTrack: subjectTrack.length ? subjectTrack : null,
  };
}
