import type { EditSpec, SfxType, TextOverlay } from "@/lib/editor-spec";
import type {
  AiEditAction,
  AiEditIntensity,
  AiEditPlan,
  EditChange,
  SignalAnalysis,
  VideoType,
} from "@/lib/ai-edit/types";
import { buildCaptionLines, placeCaptions } from "@/lib/ai-edit/captions";
import { musicMixFor, pickMusicTrack } from "@/lib/ai-edit/assets";
import { clamp01, round1 } from "@/lib/ai-edit/score";
import { createMotionDesign } from "@/lib/motion/select";

/**
 * The AI editing brain. Turns signal analysis + content hints into a
 * concrete EditSpec with a human-readable explanation and an internal
 * quality score. Every decision asks: does this improve hook, retention,
 * clarity, emotion or professionalism? If not — it is not applied.
 */

export interface PlanInput {
  signal: SignalAnalysis;
  fileName: string;
  hookText: string;
  aiAnalysis?: { topic: string; audience: string; visualNotes: string; style: string; hook: string } | null;
  action: AiEditAction;
  intensity: AiEditIntensity;
  currentSpec?: EditSpec | null;
  seed: string;
  /** Motion analysis (beats, motion energy, subject track) when available. */
  motionAnalysis?: import("@/lib/motion/types").MotionAnalysis | null;
}

interface Decisions {
  trim: { start: number; end: number | null };
  cuts: { start: number; end: number }[] | null;
  pacing: number;
  filter: EditSpec["filter"];
  custom: EditSpec["customFilter"];
  effects: NonNullable<EditSpec["effects"]>;
  captions: TextOverlay[];
  hookOverlay: TextOverlay | null;
  music: { track: string; volume: number; fadeInSec: number; fadeOutSec: number };
  sfx: { at: number; type: SfxType; volume: number }[];
  progressBar: boolean;
  loop: boolean;
  audio: NonNullable<EditSpec["audio"]>;
  changes: EditChange[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function classifyVideo(signal: SignalAnalysis, aiAnalysis?: PlanInput["aiAnalysis"]): VideoType {
  const style = (aiAnalysis?.style ?? "").toLowerCase();
  if (/(tutorial|how.?to|recipe|guide|review)/.test(style)) return "tutorial";
  if (/(talking|speaking|coach|monologue|vlog|interview|podcast|advice)/.test(style)) return "talking-head";
  if (/(comedy|funny|meme|skit|prank)/.test(style)) return "comedy";
  if (/(motivat|inspir|quote|discipline|grind)/.test(style)) return "motivational";
  if (/(action|fight|sport|dance|pov|parkour|drift|race)/.test(style)) return "action";
  if (/(emotional|sad|tribute|memorial|heart)/.test(style)) return "emotional";

  const voice = signal.voiceDensity;
  const cutsPerSec = signal.cutRate;
  if (voice >= 0.45 && cutsPerSec < 0.6) return "talking-head";
  if (cutsPerSec >= 1.2) return "action";
  if (voice >= 0.25 && cutsPerSec < 1.0) return "motivational";
  if (signal.durationSec <= 12 && cutsPerSec >= 0.5) return "action";
  return "generic";
}

// ---------------------------------------------------------------------------
// Timeline mapping (source seconds -> final seconds after smart cuts)
// ---------------------------------------------------------------------------

export interface TimelineMap {
  segments: { start: number; end: number }[];
  finalDuration: number;
}

export function buildTimeline(cuts: { start: number; end: number }[] | null, trimStart: number, trimEnd: number | null, sourceDuration: number): TimelineMap {
  const boundary = Math.max(trimStart, 0);
  const end = trimEnd ? Math.min(trimEnd, sourceDuration) : sourceDuration;
  let segments: { start: number; end: number }[];
  if (cuts && cuts.length) {
    const kept: { start: number; end: number }[] = [];
    let cursor = boundary;
    for (const c of cuts) {
      if (c.start > cursor + 0.05) kept.push({ start: cursor, end: Math.min(c.start, end) });
      cursor = Math.max(cursor, Math.min(c.end, end));
      if (cursor >= end) break;
    }
    if (cursor < end - 0.05) kept.push({ start: cursor, end });
    segments = kept.filter((s) => s.end - s.start >= 0.3);
  } else {
    segments = end > boundary ? [{ start: boundary, end }] : [];
  }
  const finalDuration = segments.reduce((a, s) => a + (s.end - s.start), 0);
  return { segments, finalDuration };
}

/** Source time -> final (post-cut) timeline time. */
export function mapToFinal(timeline: TimelineMap, sourceSec: number): number {
  if (!timeline.segments.length) return 0;
  let acc = 0;
  for (const s of timeline.segments) {
    if (sourceSec < s.start) return acc;
    if (sourceSec <= s.end) return acc + (sourceSec - s.start);
    acc += s.end - s.start;
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Hook optimization
// ---------------------------------------------------------------------------

function hookRetime(signal: SignalAnalysis, intensity: AiEditIntensity): { start: number; retimed: boolean } {
  const firstSpeech = signal.speech.length ? signal.speech[0].start : null;
  const firstScene = signal.sceneChanges.length ? signal.sceneChanges[0] : null;
  const firstNonBlack = signal.black.length ? signal.black[0].end : 0;
  const candidates = [firstSpeech, firstScene, firstNonBlack].filter((v): v is number => v !== null && v > 0.25);
  const weakest = Math.min(0.3 + 0.3 * (intensity === "aggressive" ? 1 : intensity === "smart" ? 0.6 : 0.2), 1.2);
  const target = candidates.length ? Math.min(...candidates) : 0;
  if (target >= weakest) {
    // Start just before the first interesting moment (keep a breath of context).
    return { start: Math.max(0, target - 0.18), retimed: true };
  }
  return { start: 0, retimed: false };
}

// ---------------------------------------------------------------------------
// Smart cutting
// ---------------------------------------------------------------------------

function planCuts(
  signal: SignalAnalysis,
  videoType: VideoType,
  intensity: AiEditIntensity,
  trimStart: number,
  trimEnd: number | null
): { cuts: { start: number; end: number }[] | null; removedSec: number } {
  const maxCuts = intensity === "aggressive" ? 6 : intensity === "smart" ? 4 : 2;
  const minGap = intensity === "aggressive" ? 0.4 : 0.55;
  const boundary = trimEnd ?? signal.durationSec;
  const gaps: { start: number; end: number }[] = [];

  const addGap = (s: number, e: number) => {
    const start = Math.max(trimStart, Math.min(s, boundary));
    const end = Math.min(boundary, Math.max(e, trimStart));
    if (end - start >= 0.3) gaps.push({ start, end });
  };

  const voiceDependent = ["talking-head", "tutorial", "motivational"].includes(videoType);
  if (voiceDependent && signal.voiceDensity > 0.2) {
    for (const s of signal.silence) {
      const len = s.end - s.start;
      if (len < minGap) continue;
      // Keep a tiny breath of silence so speech never sounds chopped.
      const keep = Math.min(0.25, len * 0.35);
      addGap(s.start + keep, s.end - keep);
    }
  }
  // Black frames are always dead weight.
  for (const b of signal.black) {
    if (b.end - b.start >= 0.35) addGap(b.start + 0.05, b.end - 0.05);
  }
  // Frozen runs (aggressive mode only).
  if (intensity === "aggressive" && signal.frozenFrames >= 4 && signal.durationSec > 15) {
    // Heuristic: 1s+ of identical frames ≈ a static hold; covered by silence
    // detection for speech; note it without guessing exact boundaries.
  }

  gaps.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const g of gaps) {
    const prev = merged[merged.length - 1];
    if (prev && g.start - prev.end <= 0.3) prev.end = Math.max(prev.end, g.end);
    else merged.push(g);
  }
  const kept = merged.slice(0, maxCuts);
  const removedSec = kept.reduce((a, g) => a + (g.end - g.start), 0);
  // Never cut away more than ~25% of the video.
  const maxRemovable = signal.durationSec * 0.25;
  let used = kept;
  if (removedSec > maxRemovable) {
    used = [];
    let acc = 0;
    for (const g of kept) {
      if (acc + (g.end - g.start) > maxRemovable) break;
      used.push(g);
      acc += g.end - g.start;
    }
  }
  if (!used.length) return { cuts: null, removedSec: 0 };
  return { cuts: used, removedSec: used.reduce((a, g) => a + (g.end - g.start), 0) };
}

// ---------------------------------------------------------------------------
// SFX placement
// ---------------------------------------------------------------------------

function planSfx(
  videoType: VideoType,
  intensity: AiEditIntensity,
  timeline: TimelineMap,
  signal: SignalAnalysis,
  captionTimes: number[],
  looped: boolean,
  hookRetimed: boolean
): { sfx: { at: number; type: SfxType; volume: number }[]; count: number } {
  const budget = intensity === "aggressive" ? 5 : intensity === "smart" ? 3 : 1;
  const D = timeline.finalDuration;
  if (D < 2) return { sfx: [], count: 0 };
  const out: { at: number; type: SfxType; volume: number }[] = [];
  const push = (at: number, type: SfxType, volume: number) => {
    const t = Math.max(0.05, Math.min(D - 0.1, at));
    if (!out.some((e) => Math.abs(e.at - t) < 0.35)) out.push({ at: t, type, volume });
  };
  const sceneMoments = signal.sceneChanges
    .map((s) => mapToFinal(timeline, s))
    .filter((t) => t > 0.2 && t < D - 0.2);

  switch (videoType) {
    case "talking-head": {
      for (const ct of captionTimes.slice(0, 2)) push(ct, "pop", 0.4);
      if (intensity === "aggressive" && captionTimes.length > 2) push(captionTimes[2], "click", 0.35);
      break;
    }
    case "action": {
      for (const t of sceneMoments.slice(0, budget)) push(t, "whoosh", 0.42);
      if (sceneMoments.length && intensity !== "subtle") push(sceneMoments[0], "impact", 0.5);
      if (!looped && D > 4) push(D - 0.9, "boom", 0.55);
      break;
    }
    case "motivational": {
      push(0.4, "riser", 0.38);
      const punch = captionTimes[Math.min(1, captionTimes.length - 1)];
      if (punch) push(punch, "drop", 0.5);
      if (!looped && D > 4 && intensity !== "subtle") push(D - 0.9, "boom", 0.6);
      break;
    }
    case "emotional": {
      if (intensity === "aggressive" && sceneMoments.length) push(sceneMoments[0], "whoosh", 0.3);
      break;
    }
    case "comedy": {
      for (const ct of captionTimes.slice(0, 2)) push(ct, "pop", 0.45);
      if (!looped && D > 3) push(D - 0.7, "drop", 0.45);
      break;
    }
    case "tutorial": {
      for (const ct of captionTimes.slice(0, 2)) push(ct, "click", 0.35);
      break;
    }
    default: {
      if (sceneMoments.length) push(sceneMoments[0], "whoosh", 0.4);
      if (!looped && D > 5 && intensity !== "subtle") push(D - 0.8, "boom", 0.5);
      break;
    }
  }
  if (hookRetimed && intensity !== "subtle" && out.length && out[0].at > 0.4) {
    push(0.25, "whoosh", 0.35);
  }
  const limited = out.slice(0, budget);
  return { sfx: limited, count: limited.length };
}

// ---------------------------------------------------------------------------
// Main plan builder
// ---------------------------------------------------------------------------

export async function buildEditPlan(input: PlanInput): Promise<AiEditPlan> {
  const { signal, intensity, action, seed } = input;
  const base = input.currentSpec ?? {};
  const changes: EditChange[] = [];
  const notes: string[] = [];
  const videoType = classifyVideo(signal, input.aiAnalysis);
  const D = signal.durationSec;
  const isVoice = signal.hasAudio && signal.voiceDensity > 0.15;
  // Targeted actions only touch their own domain — everything else is kept
  // exactly as the user left it.
  const targeted = action.startsWith("improve-");
  const retimeHook = !targeted || action === "improve-hook" || action === "improve-ending";

  // --- Hook: re-time the opening to the strongest moment. ---
  const { start: hookStart, retimed } = retimeHook ? hookRetime(signal, intensity) : { start: 0, retimed: false };
  let trim: { start: number; end: number | null } = {
    start: Math.max(0, base.trim?.start ?? 0, hookStart),
    end: base.trim?.end ?? null,
  };
  if (retimed) {
    changes.push({
      what: `Opening re-timed to ${trim.start.toFixed(1)}s`,
      why: "The first moments were dead (silence/black/slow start). The video now opens at the first strong visual or speech moment — the hook lands immediately.",
      category: "hook",
    });
    notes.push(`Leading dead time: ${hookStart.toFixed(1)}s trimmed.`);
  }

  // --- Trailing dead time. ---
  const lastSpeech = signal.speech.length ? signal.speech[signal.speech.length - 1].end : null;
  const lastScene = signal.sceneChanges.length ? signal.sceneChanges[signal.sceneChanges.length - 1] : null;
  const lastLive = Math.max(lastSpeech ?? 0, lastScene ?? 0);
  if (D - lastLive > 1.2 && lastLive > 2 && !base.trim?.end && (!targeted || action === "improve-ending")) {
    trim.end = Math.min(D, lastLive + 0.6);
    changes.push({
      what: `Ending trimmed from ${D.toFixed(1)}s to ${trim.end.toFixed(1)}s`,
      why: "The final seconds were dead air after the content ended. The video now ends right after the payoff.",
      category: "cuts",
    });
  }

  // --- Smart cutting. ---
  const planCutsAllowed = !targeted || action === "improve-hook" || action === "improve-ending";
  const { cuts, removedSec } = planCutsAllowed
    ? planCuts(signal, videoType, intensity, trim.start, trim.end ?? D)
    : { cuts: base.cuts ?? null, removedSec: 0 };
  const timeline = buildTimeline(cuts, trim.start, trim.end ?? D, D);
  const finalD = timeline.finalDuration;
  const bgActive = base.background?.remove === true;
  const effectiveCuts = bgActive ? null : cuts;
  if (removedSec >= 0.5) {
    changes.push({
      what: `${removedSec.toFixed(1)}s of dead weight removed`,
      why: "Silence, pauses and black frames were cut so pacing stays tight. Every kept moment moves the video forward.",
      category: "cuts",
    });
    notes.push(`${removedSec.toFixed(1)}s of ${cuts?.length ?? 0} gaps removed.`);
  }

  // --- Pacing. ---
  const lengthKey = finalD <= 10 ? "short" : finalD <= 20 ? "medium" : finalD <= 30 ? "long" : "xlong";
  let pacing = targeted ? (base.pacing ?? 1) : 1;
  if (videoType === "action" && !targeted) pacing = intensity === "aggressive" ? 1.1 : intensity === "smart" ? 1.04 : 1;
  else if (videoType === "motivational" && lengthKey === "short" && !targeted) pacing = intensity === "aggressive" ? 1.06 : 1.02;
  if (action === "fast") pacing = Math.min(1.25, (pacing ?? 1) + 0.1);
  if (action === "viral" && videoType === "action") pacing = Math.min(1.15, (pacing ?? 1) + 0.05);
  const finalPace = Math.min(1.3, Math.max(0.85, pacing));
  if (finalPace > 1.02 && !targeted) {
    changes.push({
      what: `Pace increased ${Math.round((finalPace - 1) * 100)}%`,
      why: `${videoType === "action" ? "Action footage" : "Short-form content"} holds attention better with slightly faster pacing — the edit moves without feeling rushed.`,
      category: "pacing",
    });
  }

  // --- Color. ---
  let filter: EditSpec["filter"] = "none";
  let custom: EditSpec["customFilter"] = { brightness: 0, contrast: 0, saturation: 0, hue: 0, vignette: 0, blur: 0 };
  if (targeted && action !== "improve-color") {
    filter = base.filter ?? "none";
    custom = base.customFilter ?? custom;
  } else if (action === "improve-color") {
    filter = base.filter ?? "none";
    custom = base.customFilter ?? custom;
    if (signal.brightness < 0.38) custom = { ...custom, brightness: 0.06, contrast: 0.06 };
    else if (signal.brightness > 0.68) custom = { ...custom, contrast: 0.05 };
  } else if (videoType === "motivational") {
    filter = intensity === "aggressive" ? "cinematic" : "cinematic";
    if (intensity === "aggressive") custom = { ...custom, contrast: 0.12, saturation: 0.15 };
  } else if (videoType === "action") {
    filter = "vivid";
    if (intensity === "aggressive") custom = { ...custom, contrast: 0.1, saturation: 0.1 };
  } else if (videoType === "emotional") {
    filter = "warm";
  } else if (videoType === "comedy") {
    filter = "vivid";
  } else if (signal.brightness < 0.38) {
    filter = "warm"; // fix underexposed footage
  } else if (signal.brightness > 0.68 && videoType === "generic") {
    filter = "cool"; // tame blown-out footage
  } else if (["talking-head", "tutorial"].includes(videoType)) {
    custom = { ...custom, contrast: 0.04, saturation: 0.04, brightness: 0.02 };
  }
  if (action === "cinematic") {
    filter = "cinematic";
    custom = { ...custom, vignette: 0.3 };
  }
  if (filter !== "none" || Object.values(custom).some((v) => v !== 0)) {
    changes.push({
      what: `Color graded (${filter === "none" ? "balanced look" : filter})`,
      why: "Exposure, contrast and saturation were tuned so the footage looks professionally graded — clean, not filtered.",
      category: "color",
    });
  }

  // --- Motion effects. ---
  const staticFootage = signal.cutRate < 0.15;
  let effects: NonNullable<EditSpec["effects"]> = [];
  if (targeted && action !== "improve-hook") {
    effects = base.effects ?? [];
  } else if (action === "clean") effects = [];
  else if (videoType === "talking-head") effects = staticFootage ? ["ken-burns"] : [];
  else if (videoType === "action") effects = ["zoom-intro", ...(intensity === "aggressive" ? ["shake" as const] : [])];
  else if (videoType === "motivational" || videoType === "tutorial" || videoType === "comedy") effects = ["zoom-intro"];
  else if (videoType === "emotional") effects = staticFootage ? ["ken-burns"] : [];
  else effects = staticFootage ? ["ken-burns"] : ["zoom-intro"];
  if (action === "cinematic" && !effects.includes("ken-burns")) effects = ["ken-burns"];
  if (effects.length && intensity !== "subtle") {
    changes.push({
      what: `Added ${effects.join(", ")}`,
      why: effects.includes("ken-burns")
        ? "The footage is static — a slow drift keeps the eye moving without constant zooming."
        : "A subtle opening push draws the eye in on the first frame.",
      category: "pacing",
    });
  }

  // --- Captions. ---
  const wantsCaptions =
    action === "viral" ||
    action === "improve-captions" ||
    (!targeted && ["talking-head", "motivational"].includes(videoType)) ||
    (!targeted && videoType === "tutorial" && intensity !== "subtle") ||
    (!targeted && videoType === "comedy" && intensity !== "subtle") ||
    (!targeted && intensity === "aggressive");
  let captions: TextOverlay[] = [];
  let hookOverlay: TextOverlay | null = null;
  if (targeted && action !== "improve-captions") {
    // Preserve every existing text overlay exactly as the user left it.
    captions = base.texts ?? [];
    hookOverlay = null;
  } else if (wantsCaptions) {
    const lines = await buildCaptionLines({
      fileName: input.fileName,
      hookText: input.hookText,
      aiAnalysis: input.aiAnalysis,
      videoType,
    });
    const speechFinal = signal.speech
      .map((s) => ({ start: mapToFinal(timeline, s.start), end: mapToFinal(timeline, s.end) }))
      .filter((s) => s.end - s.start >= 0.3);
    captions = placeCaptions({
      lines: lines.slice(0, lengthKey === "short" ? 2 : 4),
      speech: speechFinal,
      durationSec: finalD,
      startY: videoType === "talking-head" ? 72 : 66,
    });
    if (captions.length) {
      changes.push({
        what: `${captions.length} on-screen caption${captions.length > 1 ? "s" : ""} added`,
        why: "Short-form viewers watch with sound off — captions carry the message, and key words get an accent highlight.",
        category: "captions",
      });
    }
  } else if (input.hookText && finalD > 4 && intensity !== "subtle" && action !== "clean" && !targeted) {
    hookOverlay = {
      id: "hook-ai",
      text: input.hookText.trim().slice(0, 40),
      fontSize: 54,
      color: "#ffffff",
      strokeColor: "#000000",
      y: 12,
      animation: "pop",
      startSec: 0,
      endSec: Math.min(2.4, finalD * 0.4),
    };
    changes.push({
      what: "Hook text over the opening",
      why: "A bold opening line states the value in the first two seconds — viewers decide in under a second.",
      category: "hook",
    });
  }

  // --- Music. ---
  let track: string | null = null;
  let mix: { volume: number; fadeInSec: number; fadeOutSec: number } = { volume: 0.18, fadeInSec: 0.4, fadeOutSec: 1 };
  if (targeted) {
    track = base.music?.track ?? null;
    mix = {
      volume: base.music?.volume ?? 0.18,
      fadeInSec: base.music?.fadeInSec ?? 0.4,
      fadeOutSec: base.music?.fadeOutSec ?? 1,
    };
  } else {
    track = pickMusicTrack(videoType, finalD, seed);
    mix = musicMixFor(videoType, finalD, isVoice);
    if (action === "emotional") {
      const calm = ["Nomadic Sunset.mp3", "Meditating Beat.mp3", "Infinite Wonder.mp3", "Adventure.mp3"].find((t) => t === track) ? track : null;
      if (calm) mix.volume = 0.16;
    }
  }
  const music = { ...mix, track: track ?? "" };
  if (track && !targeted) {
    changes.push({
      what: `Music: ${track.replace(/\.(mp3|m4a|wav|ogg)$/i, "")}`,
      why: `A ${videoType.replace("-", " ")}-matched CC0 track (${music.volume > 0.25 ? "primary bed" : "ducked under the voice"}) sets the energy without covering speech.`,
      category: "music",
    });
  }

  // --- Loop decision. ---
  const loopEligible =
    action === "create-loop" || (finalD <= 15 && signal.loopScore >= 0.55 && videoType !== "talking-head" && intensity !== "subtle");
  let loopApplied = targeted ? (base.loop === true && action !== "create-loop") : loopEligible && finalD >= 4 && signal.loopScore >= (action === "create-loop" ? 0.3 : 0.55);
  if (action === "create-loop") loopApplied = loopEligible && finalD >= 4 && signal.loopScore >= 0.3;
  if (loopApplied) {
    changes.push({
      what: "Seamless loop applied",
      why: `The ending visually matches the opening (loop potential ${Math.round(signal.loopScore * 100)}%) — the video replays without an obvious seam, which boosts replays.`,
      category: "loop",
    });
  } else if (action === "create-loop") {
    notes.push(`Loop skipped: opening/ending similarity too low (${Math.round(signal.loopScore * 100)}%).`);
  }

  // --- SFX (final timeline). ---
  const captionTimes = captions.map((c) => c.startSec ?? 0);
  const { sfx, count: sfxCount } =
    targeted && action !== "improve-ending"
      ? { sfx: base.sfx ?? [], count: (base.sfx ?? []).length }
      : planSfx(videoType, intensity, timeline, signal, captionTimes, loopApplied, retimed);
  if (sfxCount && !(targeted && action !== "improve-ending")) {
    changes.push({
      what: `${sfxCount} sound effect${sfxCount > 1 ? "s" : ""} placed`,
      why: "SFX are only used at meaningful moments (scene changes, caption pops, the ending) — never spammed.",
      category: "sfx",
    });
  }

  // --- Audio engineering. ---
  const audio: NonNullable<EditSpec["audio"]> = base.audio ?? {
    noiseReduction: true,
    deesser: true,
    ducking: true,
    highpass: true,
    loudnessTarget: -14,
  };
  audio.noiseReduction = action !== "improve-color";
  audio.deesser = isVoice || videoType === "talking-head";
  audio.ducking = Boolean(track) && isVoice;
  audio.duckWindows =
    audio.ducking && signal.speech.length
      ? signal.speech.map((w) => ({ startSec: w.start, endSec: w.end }))
      : base.audio?.duckWindows ?? null;
  audio.highpass = true;
  audio.loudnessTarget = videoType === "emotional" ? -16 : intensity === "aggressive" ? -13.5 : -14;
  const audioChanged =
    signal.hasAudio &&
    (audio.noiseReduction || audio.deesser || audio.highpass || audio.ducking || audio.loudnessTarget !== -14);
  if (audioChanged) {
    changes.push({
      what: "Audio engineered",
      why: "Noise, hiss and rumble reduced; loudness normalized; music auto-ducks under the voice. Voice always sits above music and effects.",
      category: "audio",
    });
  }
  if (signal.loudness) {
    notes.push(`Source loudness ${signal.loudness.inputI.toFixed(1)} LUFS (target ${audio.loudnessTarget}).`);
  }
  if (signal.frozenFrames >= 4) notes.push(`${signal.frozenFrames} frozen frames detected.`);
  if (signal.black.length) notes.push(`${signal.black.length} black segment(s) found.`);

  // --- Progress bar (retention cue). ---
  const progressBar = targeted
    ? base.progressBar === true
    : (["motivational", "action"].includes(videoType) || action === "viral") && intensity !== "subtle" && finalD >= 8;
  if (progressBar && !targeted) {
    changes.push({
      what: "Progress bar added",
      why: "A visible progress bar lifts watch-through on longer Shorts — viewers see the payoff is close.",
      category: "pacing",
    });
  }

  // --- Motion Graphics & Effects engine (AI-designed, applied automatically). ---
  let motionSpec = base.motion && base.motion.enabled ? base.motion : null;
  let motionSfx: { at: number; type: SfxType; volume: number }[] = [];
  if (!targeted && action !== "clean" && input.motionAnalysis) {
    const motionDesign = createMotionDesign({
      analysis: input.motionAnalysis,
      signal: {
        durationSec: D,
        cutRate: signal.cutRate,
        hasAudio: signal.hasAudio,
        sceneChanges: signal.sceneChanges,
        voiceDensity: signal.voiceDensity,
        brightness: signal.brightness,
      },
      videoType,
      aiAnalysis: input.aiAnalysis,
      intensity,
      texts: [...captions, ...(hookOverlay ? [hookOverlay] : [])],
      durationSec: finalD,
      seed: `${input.seed}|motion`,
      timeline,
    });
    if (motionDesign.spec.enabled) {
      motionSpec = motionDesign.spec;
      changes.push(
        ...motionDesign.changes.map((c) => ({ ...c, category: "motion" as const })),
        {
          what: "Motion graphics + text animation + 3D effects",
          why: "Beats, subject movement and content type drove a purposeful effect design (camera, 3D kinetic text, overlays, transitions) — nothing random.",
          category: "motion",
        }
      );
      notes.push(...motionDesign.notes);
      motionSfx = motionDesign.sfx;
    }
  }

  // --- Summary. ---
  const summaryParts: string[] = [];
  summaryParts.push(
    `${videoType.replace("-", " ")} detected — edited for ${lengthKey === "short" ? "fast hooks and replays" : lengthKey === "medium" ? "hooks, payoff and replay" : "retention checkpoints and payoff"}.`
  );
  if (retimed) summaryParts.push("Opening re-timed to the strongest moment.");
  if (removedSec >= 0.5) summaryParts.push(`${removedSec.toFixed(1)}s of dead time cut.`);
  if (captions.length) summaryParts.push(`${captions.length} emphasized captions.`);
  if (sfxCount) summaryParts.push(`${sfxCount} purposeful SFX.`);
  if (loopApplied) summaryParts.push("Seamless loop.");
  if (audioChanged) summaryParts.push("Audio engineered for clarity.");
  const summary = summaryParts.join(" ");

  const mergedSfx = [...sfx, ...motionSfx].sort((a, b) => a.at - b.at);
  const spec: EditSpec = {
    ...base,
    trim,
    filter,
    customFilter: custom,
    effects,
    texts: [...captions, ...(hookOverlay ? [hookOverlay] : [])],
    music,
    cuts: effectiveCuts,
    sfx: mergedSfx.length ? mergedSfx : null,
    audio,
    loop: loopApplied,
    pacing: finalPace !== 1 ? finalPace : undefined,
    progressBar,
    motion: motionSpec,
    background: base.background ?? undefined,
    updatedAt: new Date().toISOString(),
  };

  // --- Internal score. ---
  const score = computeScore({
    signal,
    videoType,
    intensity,
    retimed,
    removedSec,
    captions,
    sfxCount,
    loopApplied,
    audioChanged,
    finalD,
    finalPace,
    filter,
    hasMusic: Boolean(track),
  });

  return {
    videoType,
    intensity,
    action,
    summary,
    changes,
    score,
    spec,
    musicTrack: track,
    analysisNotes: notes,
    revisions: 0,
    hookRetimed: retimed,
    looped: loopApplied,
    sfxUsed: mergedSfx.map((e) => ({ type: e.type, at: round1(e.at) })),
  };
}

// ---------------------------------------------------------------------------
// Scoring (internal optimization metric — never a views prediction)
// ---------------------------------------------------------------------------

interface ScoreInput {
  signal: SignalAnalysis;
  videoType: VideoType;
  intensity: AiEditIntensity;
  retimed: boolean;
  removedSec: number;
  captions: TextOverlay[];
  sfxCount: number;
  loopApplied: boolean;
  audioChanged: boolean;
  finalD: number;
  finalPace: number;
  filter: EditSpec["filter"];
  hasMusic: boolean;
}

export function computeScore(i: ScoreInput): AiEditPlan["score"] {
  const { signal } = i;

  // Hook: opening quality.
  let hook = 55;
  if (i.retimed) hook += 18;
  else if (signal.speech.length && signal.speech[0].start < 0.8) hook += 12;
  else if (signal.sceneChanges.length && signal.sceneChanges[0] < 0.8) hook += 12;
  if (signal.silence.length && signal.silence[0].start > 2.5 && !i.retimed) hook -= 18;
  if (i.intensity === "subtle") hook += 3; // restraint is a feature
  hook = Math.max(0, Math.min(100, hook));

  // Visual quality.
  let visual = 62;
  visual += signal.brightness > 0.38 && signal.brightness < 0.62 ? 12 : signal.brightness < 0.3 || signal.brightness > 0.72 ? -10 : 4;
  visual += signal.width >= 1920 ? 12 : signal.width >= 1280 ? 8 : signal.width >= 720 ? 3 : 0;
  visual += i.filter && i.filter !== "none" ? 5 : 2;
  visual -= Math.min(20, signal.frozenFrames * 3);
  visual -= signal.loopScore < 0.15 && i.finalD <= 15 ? 4 : 0;
  visual = Math.max(0, Math.min(100, visual));

  // Audio.
  let audio = 58;
  if (signal.hasAudio) audio += 14;
  if (i.audioChanged) audio += 8;
  if (signal.loudness) {
    if (signal.loudness.inputI >= -20 && signal.loudness.inputI <= -10) audio += 8;
    else if (signal.loudness.inputI > -8) audio -= 8;
  }
  if (i.hasMusic) audio += 3;
  audio = Math.max(0, Math.min(100, audio));

  // Pacing fit.
  let pacingScore = 62;
  const cutsPerSec = signal.cutRate;
  if (i.videoType === "action") pacingScore += cutsPerSec >= 1.2 && cutsPerSec <= 5 ? 16 : 2;
  else if (i.videoType === "talking-head") pacingScore += cutsPerSec <= 0.5 ? 14 : 5;
  else if (i.videoType === "motivational") pacingScore += cutsPerSec >= 0.3 && cutsPerSec <= 2 ? 12 : 4;
  if (i.removedSec >= 0.5) pacingScore += 8;
  if (i.finalPace > 1 && i.finalPace <= 1.15) pacingScore += 4;
  pacingScore = Math.max(0, Math.min(100, pacingScore));

  // Captions.
  let captionScore = 60;
  if (["talking-head", "motivational"].includes(i.videoType)) {
    captionScore = i.captions.length >= 2 ? 90 : i.captions.length === 1 ? 78 : 45;
  } else {
    captionScore = i.captions.length ? 82 : 58;
  }
  captionScore = Math.max(0, Math.min(100, captionScore));

  // Retention potential.
  const retention = clamp01(
    0.5 * (hook / 100) + 0.25 * (pacingScore / 100) + 0.15 * (captionScore / 100) + 0.1 * (i.sfxCount > 0 ? 1 : 0.6)
  );

  // Loop/replay.
  const loop = i.loopApplied ? Math.round(clamp01(0.8 + signal.loopScore * 0.2) * 100) : Math.round(clamp01(0.35 + signal.loopScore * 0.4) * 100);

  // Overall.
  const overall = Math.round(
    hook * 0.18 + visual * 0.15 + audio * 0.15 + pacingScore * 0.15 + captionScore * 0.12 + retention * 0.15 + loop * 0.1
  );

  return {
    hook: Math.round(hook),
    visual: Math.round(visual),
    audio: Math.round(audio),
    pacing: Math.round(pacingScore),
    captions: Math.round(captionScore),
    retention: Math.round(retention * 100),
    loop: Math.round(loop),
    overall,
  };
}