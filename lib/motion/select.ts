import type { SfxType } from "@/lib/editor-spec";
import type {
  MotionDesignInput,
  MotionDesignResult,
  MotionIntensity,
  MotionKeyframe,
  MotionSpec,
  MotionStyleKey,
  MotionText3D,
} from "@/lib/motion/types";
import { defaultMotionSpec } from "@/lib/motion/types";

/**
 * The AI Motion Graphics selector. Turns analysis (beats, motion energy,
 * subject track) + content understanding (video type, vision notes) into a
 * purposeful MotionSpec.
 *
 * Core rules:
 *  1. RESTRAINT — every element must serve hook, pacing, clarity or impact.
 *  2. Content-fit — action gets punch, talking-heads get kinetic captions,
 *     emotional footage gets glow + depth, tutorials get clean clarity.
 *  3. Music-fit — beat-synced pulses, ramps and SFX only when a real rhythm
 *     grid was detected.
 *  4. Subject-fit — text follows / sits behind the FULL subject only when
 *     real tracking is available.
 *  5. Deterministic — same inputs, same design (no randomness).
 */

const TYPES = new Set(["talking-head", "action", "motivational", "emotional", "tutorial", "comedy", "generic"]);

export function normalizeStyle(style: unknown): MotionStyleKey {
  const s = String(style ?? "");
  return s === "dynamic-punchy" || s === "clean-minimal" || s === "energetic-pop" || s === "modern-cinematic"
    ? (s as MotionStyleKey)
    : "modern-cinematic";
}

function hashSeed(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

interface Ctx {
  input: MotionDesignInput;
  type: string;
  style: MotionStyleKey;
  int: MotionIntensity;
  D: number;
  h: number;
  changes: { what: string; why: string }[];
  notes: string[];
  sfx: { at: number; type: SfxType; volume: number }[];
}

/** Source → final timeline mapping (duplicate of plan.ts, no import cycle). */
function mapToFinal(timeline: { segments: { start: number; end: number }[] }, sourceSec: number): number {
  let acc = 0;
  for (const s of timeline.segments) {
    if (sourceSec < s.start) return acc;
    if (sourceSec <= s.end) return acc + (sourceSec - s.start);
    acc += s.end - s.start;
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Camera path
// ---------------------------------------------------------------------------

/** Slow, smooth push for talking-heads/emotional/static footage. */
function gentleCamera(ctx: Ctx, endZoom: number, panTilt: number): MotionKeyframe[] {
  const t = Math.max(1.5, ctx.D * 0.55);
  return [
    { t: 0, zoom: 1, panX: 0, panY: 0 },
    { t: Math.min(t, ctx.D * 0.8), zoom: endZoom, panX: panTilt, panY: -panTilt * 0.6 },
    { t: ctx.D, zoom: Math.max(1, endZoom - 0.03), panX: panTilt * 0.4, panY: 0 },
  ];
}

/** Drift that follows the subject's horizontal motion (if tracked). */
function subjectCamera(ctx: Ctx, endZoom: number): MotionKeyframe[] {
  const s = ctx.input.analysis.subject.samples;
  const startCx = s.length ? s[0].cx : 0.5;
  const endCx = s.length ? s[s.length - 1].cx : 0.5;
  const drift = clamp((endCx - startCx) * 0.7, -0.35, 0.35);
  return [
    { t: 0, zoom: 1, panX: 0, panY: 0 },
    { t: Math.max(1, ctx.D * 0.5), zoom: endZoom, panX: drift, panY: 0 },
    { t: ctx.D, zoom: endZoom, panX: drift * 0.5, panY: 0 },
  ];
}

/** Action: punchy dynamic path keyed to beats. */
function actionCamera(ctx: Ctx, beats: number[]): MotionKeyframe[] {
  const kf: MotionKeyframe[] = [{ t: 0, zoom: 1, panX: 0, panY: 0 }];
  const spots = beats.filter((b) => b > 0.3 && b < ctx.D - 0.5).slice(0, 4);
  spots.forEach((b, i) => {
    kf.push({ t: b - 0.08, zoom: 1.04, panX: i % 2 === 0 ? 0.12 : -0.1, panY: i % 2 === 0 ? -0.06 : 0.06 });
    kf.push({ t: b + 0.12, zoom: 1.13, panX: 0, panY: 0 });
  });
  kf.push({ t: ctx.D, zoom: 1.08, panX: 0, panY: 0 });
  return kf.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// Beats + impacts
// ---------------------------------------------------------------------------

function pickImpactMoments(ctx: Ctx, count: number): number[] {
  const beats = ctx.input.analysis.beats.beats.filter((b) => b > 0.25 && b < ctx.D - 0.4);
  const motion = ctx.input.analysis.motion.samples;
  const moments: number[] = [];
  const all = [
    ...beats.map((b) => ({ t: b, w: ctx.input.analysis.musicDriven ? 2 : 1 })),
    ...motion
      .filter((s) => s.energy > ctx.input.analysis.motion.avg * 1.6)
      .map((s) => ({ t: s.t, w: 1 })),
  ];
  all.sort((a, b) => a.t - b.t);
  for (const m of all) {
    if (!moments.length || m.t - moments[moments.length - 1] > 0.6) moments.push(m.t);
    if (moments.length >= count) break;
  }
  return moments;
}

// ---------------------------------------------------------------------------
// Main selector
// ---------------------------------------------------------------------------

export function createMotionDesign(input: MotionDesignInput): MotionDesignResult {
  const style = input.style ? normalizeStyle(input.style) : pickStyle(input);
  const type = TYPES.has(input.videoType) ? input.videoType : "generic";
  const ctx: Ctx = {
    input,
    type,
    style,
    int: input.intensity,
    D: input.durationSec,
    h: hashSeed(input.seed),
    changes: [],
    notes: [],
    sfx: [],
  };

  if (input.preserve) {
    return {
      spec: defaultMotionSpec(),
      changes: [],
      notes: ["Motion design preserved (targeted action)."],
      sfx: [],
    };
  }
  if (ctx.D < 2.5) {
    return {
      spec: { ...defaultMotionSpec(), enabled: input.force === true, style },
      changes: [],
      notes: ["Clip too short for motion graphics."],
      sfx: [],
    };
  }

  const analysis = input.analysis;
  const timeline = input.timeline ?? null;
  const beats = analysis.beats.beats
    .map((b) => (timeline ? mapToFinal(timeline, b) : b))
    .filter((b) => b > 0.15 && b < ctx.D - 0.3);
  const subjectOk = analysis.subject.available && analysis.subject.samples.length >= 3;
  const subjectTrack = subjectOk
    ? timeline
      ? analysis.subject.samples.map((s) => ({ ...s, t: mapToFinal(timeline, s.t) }))
      : analysis.subject.samples
    : null;
  const spec: MotionSpec = {
    ...defaultMotionSpec(),
    enabled: true,
    style,
    intensity: ctx.int,
    beats,
    subjectTrack,
  };

  // --- Camera path -------------------------------------------------------
  let cameraWhy = "";
  if (type === "action") {
    spec.camera = actionCamera(ctx, beats);
    cameraWhy = "beat-keyed push-ins that ride the rhythm and sell the cuts.";
  } else if (type === "talking-head") {
    spec.camera = subjectOk ? subjectCamera(ctx, 1.06) : gentleCamera(ctx, 1.05, 0.08);
    cameraWhy = "a slow, steady drift — motion never competes with the person talking.";
  } else if (type === "emotional") {
    spec.camera = subjectOk ? subjectCamera(ctx, 1.08) : gentleCamera(ctx, 1.08, 0.05);
    cameraWhy = "a gentle breath-like push that supports the mood without drawing attention.";
  } else if (type === "tutorial") {
    spec.camera = gentleCamera(ctx, 1.04, 0.06);
    cameraWhy = "barely-there movement keeps the eye on the steps.";
  } else {
    spec.camera = gentleCamera(ctx, style === "dynamic-punchy" ? 1.12 : 1.07, 0.1);
    cameraWhy = "a smooth cinematic push with natural easing.";
  }
  if (ctx.int === "subtle") {
    spec.camera = gentleCamera(ctx, 1.04, 0.04);
    cameraWhy = "subtle mode — the camera barely moves.";
  }
  ctx.changes.push({
    what: "Smooth camera path",
    why: `Every move is eased (no jerks): ${cameraWhy}`,
  });

  // --- Beat pulse --------------------------------------------------------
  const pulseByType: Record<string, number> = {
    "talking-head": 0.08, action: 0.4, motivational: 0.32, emotional: 0.1, tutorial: 0.08, comedy: 0.3, generic: 0.18,
  };
  const pulseCap: Record<MotionIntensity, number> = { subtle: 0.14, smart: 0.3, aggressive: 0.45 };
  if (beats.length >= 2 && analysis.musicDriven) {
    spec.beatPulse = Math.min(pulseCap[ctx.int], pulseByType[type] ?? 0.18);
    ctx.changes.push({
      what: "Beat-synced pulse",
      why: `A ${Math.round(analysis.beats.bpm)} BPM rhythm grid was detected — the frame breathes on the beat (${Math.round(spec.beatPulse * 100)}% strength).`,
    });
  } else if (beats.length >= 2 && style === "energetic-pop") {
    spec.beatPulse = 0.22;
    ctx.changes.push({ what: "Gentle beat pulse", why: "Energetic-pop style pulses on the detected energy peaks." });
  } else {
    spec.beatPulse = 0;
    ctx.notes.push("No confident rhythm grid — beat-synced effects skipped.");
  }

  // --- Punch-in + impact shake -------------------------------------------
  const punches: Record<string, boolean> = {
    action: true, motivational: true, comedy: true, generic: true,
  };
  const punchStrength: Record<MotionIntensity, number> = { subtle: 0.12, smart: 0.28, aggressive: 0.42 };
  const impact = pickImpactMoments(ctx, 2);
  if ((punches[type] || style === "dynamic-punchy") && impact.length) {
    const at = impact[0];
    const strength = punchStrength[ctx.int] * (style === "dynamic-punchy" ? 1.15 : 1);
    spec.punchIn = { at, strength };
    ctx.changes.push({
      what: `Punch-in at ${at.toFixed(1)}s`,
      why: "A fast zoom spike lands exactly on the strongest early moment — a physical 'impact' that pulls the eye in.",
    });
    ctx.sfx.push({ at: Math.max(0.05, at - 0.05), type: "impact", volume: 0.5 });
    if (type !== "talking-head" && type !== "emotional" && type !== "tutorial") {
      const shakeTimes = impact.slice(0, ctx.int === "aggressive" ? 3 : 2);
      const shakeAmp = ctx.int === "subtle" ? 0.1 : ctx.int === "smart" ? 0.2 : 0.32;
      spec.shake = { at: shakeTimes, strength: shakeAmp };
      ctx.changes.push({
        what: "Impact shake",
        why: `A short decaying shake on ${shakeTimes.length} impact${shakeTimes.length > 1 ? "s" : ""} sells the cut without nausea (under 0.3s each).`,
      });
    }
  } else {
    spec.punchIn = null;
    spec.shake = { at: [], strength: 0 };
  }

  // --- Speed ramps -------------------------------------------------------
  if (type === "action" && ctx.D >= 4 && beats.length) {
    const rampOn = beats.find((b) => b > 1.2 && b < ctx.D - 1);
    const ramps = [{ start: Math.max(0.5, (rampOn ?? 1.5) - 0.2), end: (rampOn ?? 1.5) + 0.25, factor: 0.5 }];
    if (ctx.int === "aggressive" && ctx.D >= 8 && impact.length > 1) {
      ramps.push({ start: impact[1] - 0.15, end: impact[1] + 0.2, factor: 0.45 });
    }
    spec.speedRamps = ramps;
    ctx.changes.push({
      what: `${ramps.length} beat-synced speed ramp${ramps.length > 1 ? "s" : ""}`,
      why: "The clip drops to 0.5× on the beat, then snaps back — a signature high-retention short-form rhythm.",
    });
  } else if (style === "dynamic-punchy" && ctx.D >= 5 && impact.length) {
    spec.speedRamps = [{ start: Math.max(0.4, impact[0] - 0.2), end: impact[0] + 0.25, factor: 0.55 }];
    ctx.changes.push({ what: "Impact slow-mo", why: "Dynamic style freezes the action for a split second at the impact." });
  } else {
    spec.speedRamps = [];
  }

  // --- Transitions -------------------------------------------------------
  const sceneMoments = input.signal.sceneChanges.filter((s) => s > 0.4 && s < ctx.D - 0.4);
  if (type === "action" && sceneMoments.length) {
    const flashAt = sceneMoments.slice(0, 3);
    spec.transitions = { xfade: false, flashAt };
    ctx.changes.push({
      what: `${flashAt.length} flash transitions`,
      why: "A white flash at each scene change makes the cuts feel intentional and keeps the pace electric.",
    });
  } else if (type === "comedy" && beats.length) {
    spec.transitions = { xfade: false, flashAt: beats.slice(1, 3).map((b) => b + 0.15) };
    ctx.changes.push({ what: "Punchline flashes", why: "Flash on the punch beats frames the joke." });
  } else if (type === "emotional" && ctx.D > 5) {
    spec.transitions = { xfade: false, flashAt: [Math.max(0.5, ctx.D - 0.7)] };
    ctx.changes.push({ what: "Ending dip", why: "A gentle fade-to-black ending closes the emotion." });
  } else {
    spec.transitions = null;
  }

  // --- Overlays ----------------------------------------------------------
  const o = spec.overlays;
  const wantsCinematic = style === "modern-cinematic";
  if (wantsCinematic && (type === "motivational" || type === "action" || type === "generic")) {
    o.letterbox = true;
    ctx.changes.push({ what: "Cinematic letterbox", why: "Subtle bars instantly read as 'film' and focus the eye on the subject band." });
  }
  o.grain = wantsCinematic ? 0.3 : type === "emotional" ? 0.2 : type === "action" ? 0.25 : 0;
  if (o.grain) ctx.changes.push({ what: "Film grain", why: "A whisper of grain keeps footage looking organic and premium." });
  if (type === "emotional" || type === "motivational" || wantsCinematic) {
    o.glow = {
      strength: type === "emotional" ? 0.5 : type === "motivational" ? 0.32 : 0.22,
      color: type === "emotional" ? "#FFD9A0" : "#FFF3D6",
    };
    ctx.changes.push({ what: "Soft glow", why: "A warm screened glow lifts the subject off the background." });
  }
  if ((type === "motivational" && ctx.int !== "subtle") || (type === "action" && ctx.int === "aggressive") || (style === "modern-cinematic" && type === "motivational")) {
    o.rays = { strength: 0.4 };
    ctx.changes.push({ what: "Light rays", why: "Slow sweeping light adds cinematic depth behind the subject." });
  }
  if (type === "action" || (type === "comedy" && ctx.int !== "subtle") || style === "energetic-pop") {
    o.particles = {
      kind: type === "comedy" ? "spark" : "dust",
      density: type === "action" ? 0.5 : 0.6,
      color: type === "comedy" ? "#FFD60A" : "#FFFFFF",
    };
    ctx.changes.push({
      what: type === "comedy" ? "Sparks" : "Particle dust",
      why: type === "comedy" ? "Golden sparks catch the eye at punchlines." : "Fine drifting dust gives the frame life without clutter.",
    });
  }
  o.vignette = wantsCinematic ? 0.28 : 0;
  if (o.vignette) ctx.changes.push({ what: "Cinematic vignette", why: "Corners gently fall off to hold attention on the center." });

  // --- Motion trails -----------------------------------------------------
  if (type === "action" && analysis.motion.avg > 0.06) {
    spec.trails = ctx.int === "aggressive" ? 4 : 3;
    ctx.changes.push({ what: "Motion trails", why: "Light ghosting on fast motion makes movement feel fluid and expensive." });
  } else if (style === "dynamic-punchy" && analysis.motion.avg > 0.04) {
    spec.trails = 3;
    ctx.changes.push({ what: "Motion trails", why: "Dynamic style adds a touch of ghost trail to movement." });
  } else {
    spec.trails = 0;
  }

  // --- Parallax / depth --------------------------------------------------
  if (subjectOk && (type === "emotional" || wantsCinematic || type === "talking-head")) {
    spec.parallax = type === "emotional" ? 0.5 : 0.28;
    spec.needsSubject = true;
    ctx.changes.push({
      what: "Parallax depth",
      why: `The background breathes at a different rate than the subject (${Math.round(spec.parallax * 100)}% depth) — real 3D separation.`,
    });
  }

  // --- Text 3D + kinetic + tracking --------------------------------------
  const texts = input.texts.slice(0, 6);
  const entranceByType: Record<string, MotionText3D["entrance"]> = {
    "talking-head": "flip", action: "slam", motivational: "rise3d", emotional: "fade",
    tutorial: "rise3d", comedy: "slam", generic: "flip",
  };
  const depthByInt: Record<MotionIntensity, number> = { subtle: 2, smart: 4, aggressive: 6 };
  let textCount = 0;
  for (const t of texts) {
    const isHook = textCount === 0;
    const dur = (t.startSec ?? 0) + 2.5;
    const td: MotionText3D = {
      depth: type === "emotional" ? 0 : depthByInt[ctx.int],
      rotateX: 0,
      rotateY: 0,
      entrance: "fade",
      kinetic: false,
      follow: false,
      behind: false,
      accent: true,
    };
    if (type === "motivational" || style === "modern-cinematic") {
      td.rotateX = 6 + (ctx.int === "aggressive" ? 3 : 0);
      td.rotateY = 5;
    }
    if (isHook) {
      td.entrance = entranceByType[type] ?? "flip";
      if (type === "motivational" && ctx.int === "aggressive") td.entrance = "spin";
      td.depth = type === "emotional" ? 2 : Math.min(8, td.depth + 2);
      if (subjectOk && (type === "emotional" || style === "modern-cinematic")) td.behind = true;
    } else {
      // Captions: kinetic for voice-heavy content, gentle fade elsewhere.
      const kinetic = ["talking-head", "motivational", "tutorial", "comedy"].includes(type) && t.text.split(/\s+/).length >= 3;
      td.kinetic = kinetic;
      td.entrance = kinetic ? "none" : isHook ? td.entrance : "fade";
      if (subjectOk && type === "talking-head" && t.text.length > 0) td.follow = true;
      if (td.follow) spec.needsSubject = true;
      if (td.behind) spec.needsSubject = true;
    }
    spec.text3d[t.id] = td;
    textCount++;
    if (dur > 0) {
      ctx.sfx.push({ at: Math.max(0.05, (t.startSec ?? 0) - 0.04), type: "pop", volume: 0.35 });
    }
  }
  const animCount = Object.values(spec.text3d).filter((t) => t.entrance !== "fade" && t.entrance !== "none").length;
  const kineticCount = Object.values(spec.text3d).filter((t) => t.kinetic).length;
  const followCount = Object.values(spec.text3d).filter((t) => t.follow).length;
  if (animCount) {
    ctx.changes.push({
      what: `${animCount} 3D text entrance${animCount > 1 ? "s" : ""}`,
      why: `Text lands with ${animCount > 1 ? "matched" : "a"} ${Object.values(spec.text3d).find((t) => t.entrance !== "fade" && t.entrance !== "none")?.entrance} — bold but over in under half a second, never lingering.`,
    });
  }
  if (kineticCount) {
    ctx.changes.push({ what: "Kinetic typography", why: "Captions build word-by-word so the message lands one beat at a time — proven retention for sound-off viewing." });
  }
  if (followCount) {
    ctx.changes.push({ what: "Subject-tracked text", why: `Captions follow the person's FULL body position (motion tracking), so text never covers the speaker.` });
  }
  if (Object.values(spec.text3d).some((t) => t.behind)) {
    ctx.changes.push({ what: "Text behind subject", why: "The hook sits behind the person — a layered 3D composition with real depth." });
  }

  // --- Text + SFX sync summary -------------------------------------------
  const uniqueSfx = dedupeSfx(ctx.sfx);
  ctx.sfx = uniqueSfx;
  if (uniqueSfx.length) {
    ctx.changes.push({
      what: `${uniqueSfx.length} synced SFX`,
      why: "Every pop/impact lands on a beat or text reveal — sound and motion agree, which reads as professional.",
    });
  }
  if (!spec.needsSubject && type !== "talking-head" && type !== "emotional" && analysis.subject.available) {
    spec.needsSubject = false;
  }

  return { spec, changes: ctx.changes, notes: ctx.notes, sfx: ctx.sfx };
}

/** The AI picks the style from content + music when the user didn't. */
export function pickStyle(input: MotionDesignInput): MotionStyleKey {
  const style = (input.aiAnalysis?.style ?? "").toLowerCase();
  if (/(pov|fight|sport|dance|race|drift|parkour|action)/.test(style) || input.videoType === "action") {
    return "dynamic-punchy";
  }
  if (/(quote|motivat|inspir|discipline)/.test(style) || input.videoType === "motivational") {
    return "modern-cinematic";
  }
  if (/(comedy|funny|meme|prank)/.test(style) || input.videoType === "comedy") {
    return "energetic-pop";
  }
  if (/(tutorial|how.?to|recipe|review|guide)/.test(style) || input.videoType === "tutorial") {
    return "clean-minimal";
  }
  if (input.videoType === "emotional" || /(sad|tribute|emotional)/.test(style)) {
    return "modern-cinematic";
  }
  return input.analysis.musicDriven ? "modern-cinematic" : "clean-minimal";
}

function dedupeSfx(sfx: { at: number; type: SfxType; volume: number }[]): { at: number; type: SfxType; volume: number }[] {
  const out: { at: number; type: SfxType; volume: number }[] = [];
  for (const e of sfx.sort((a, b) => a.at - b.at)) {
    if (!out.some((o) => Math.abs(o.at - e.at) < 0.3)) out.push(e);
  }
  return out;
}