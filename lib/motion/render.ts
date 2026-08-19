import type { EditSpec, TextOverlay } from "@/lib/editor-spec";
import { escapeDrawText } from "@/lib/editor";
import type { MotionSpec, MotionSpeedRamp, MotionText3D, SubjectTrack } from "@/lib/motion/types";

/**
 * FFmpeg filter-graph builders for the Motion Graphics engine. These are
 * pure expression/graph generators — the editor (lib/editor.ts) composes
 * them into the main render graph in the right layer order.
 *
 * Techniques (all validated against the bundled ffmpeg 6.1):
 *  - Smooth camera: piecewise cubic-basis keyframes evaluated per frame by
 *    crop x/y expressions (this build has no crop `eval` option, but x/y are
 *    evaluated per-frame by default).
 *  - 3D text: layered drawtext extrusion + animated scale/rotate + static
 *    perspective tilt, rendered on their own alpha tracks so transforms stay
 *    independent of the footage.
 *  - Beat sync: gaussian bumps baked into camera/scale expressions.
 *  - Glow/rays/particles: screen-blended synthetic layers (gblur, noise).
 *  - Motion trails: tmix ghosting. Speed ramps: segmented trims + atempo +
 *    optional minterpolate. Transitions: chained xfade / white-flash layers.
 */

export interface RenderPiece {
  start: number;
  end: number;
  factor: number;
}

/** Split the source into render pieces (cuts + speed ramps, final timeline). */
export function buildPieces(opts: {
  trimStart: number;
  trimEnd: number | null;
  cuts: { start: number; end: number }[] | null;
  ramps: MotionSpeedRamp[];
  sourceDuration: number;
}): RenderPiece[] {
  const end = opts.trimEnd ?? opts.sourceDuration;
  let base: RenderPiece[];
  if (opts.cuts && opts.cuts.length) {
    base = opts.cuts
      .map((c) => ({ start: Math.max(0, c.start), end: Math.min(end, c.end), factor: 1 }))
      .filter((p) => p.end - p.start >= 0.2);
  } else {
    base = [{ start: Math.max(0, opts.trimStart), end, factor: 1 }];
  }
  if (!base.length) return [];
  for (const r of opts.ramps) {
    const next: RenderPiece[] = [];
    for (const p of base) {
      if (r.start >= p.end - 0.05 || r.end <= p.start + 0.05) {
        next.push(p);
        continue;
      }
      const s1 = Math.max(p.start, r.start);
      const e1 = Math.min(p.end, r.end);
      if (s1 - p.start >= 0.15) next.push({ ...p, end: s1 });
      if (e1 - s1 >= 0.12) next.push({ start: s1, end: e1, factor: clampF(r.factor) });
      if (p.end - e1 >= 0.15) next.push({ ...p, start: e1 });
    }
    base = next;
  }
  return base.filter((p) => p.end - p.start >= 0.15);
}

function clampF(f: number): number {
  return Math.min(1.6, Math.max(0.4, f));
}

export function pieceFinalDuration(p: RenderPiece): number {
  return (p.end - p.start) / clampF(p.factor);
}

// ---------------------------------------------------------------------------
// Expression helpers (ffmpeg expression language)
// ---------------------------------------------------------------------------

/**
 * Cubic partition-of-unity basis over keyframes → a smooth value(t)
 * expression. Natural easing; no discontinuities.
 */
export function smoothKeyframeExpr(keys: { t: number; v: number }[], tVar = "t"): string {
  if (!keys.length) return "0";
  if (keys.length === 1) return keys[0].v.toFixed(4);
  const span = keys[keys.length - 1].t - keys[0].t;
  const spread = Math.max(0.35, (span / Math.max(1, keys.length - 1)) * 0.8);
  const weights = keys.map((k) => `pow(max(0,1-abs(${tVar}-${k.t.toFixed(3)})/${spread.toFixed(3)}),3)`);
  const num = keys.map((k, i) => `(${k.v.toFixed(4)})*${weights[i]}`).join("+");
  const den = weights.join("+");
  return `(${num})/(${den}+1e-9)`;
}

/** Sum of gaussian bumps — smooth pulses at given times (e.g. beats). */
export function gaussSumExpr(events: number[], sigma: number, tVar = "t"): string {
  const parts = events.map(
    (b) => `exp(-0.5*pow(${tVar}-${b.toFixed(3)},2)/pow(${sigma.toFixed(3)},2))`
  );
  if (!parts.length) return "0";
  return parts.join("+");
}

/** Decaying sine bursts — impact shake. */
export function shakeExpr(at: number[], strength: number, tVar = "t"): string {
  const parts = at.map((b) => {
    const env = `exp(-pow(${tVar}-${b.toFixed(3)},2)/(2*pow(0.13,2)))`;
    return `(${strength.toFixed(4)})*${env}*sin(2*PI*9.5*(${tVar}-${b.toFixed(3)}))`;
  });
  if (!parts.length) return "0";
  return parts.join("+");
}

export function clampExpr(expr: string, min: number, max: number): string {
  return `max(${min},min(${max},${expr}))`;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export interface CameraResult {
  /** Overscale factor (max zoom). */
  maxZoom: number;
  ow: number;
  oh: number;
  /** Label of the camera-applied video ([cam]). */
  ref: string;
  /** Crop window X expression (pre-scaled coords) — used by follow-text. */
  cropXExpr: string;
  cropYExpr: string;
  zoomExpr: string;
}

/** Compute the camera crop expressions (no graph emitted yet). */
export function computeCameraExpressions(motion: MotionSpec, W: number, H: number): Omit<CameraResult, "ref"> {
  const kfs = motion.camera.length ? motion.camera : [{ t: 0, zoom: 1, panX: 0, panY: 0 }];
  const punch = motion.punchIn;
  const baseZoom =
    Math.max(1, ...kfs.map((k) => k.zoom)) + (punch ? punch.strength : 0) + motion.beatPulse * 0.6;
  const maxZoom = Math.max(1.12, Math.min(1.6, baseZoom));

  const zoomBase = smoothKeyframeExpr(
    kfs.map((k) => ({ t: k.t, v: Math.max(1, k.zoom) })),
    "t"
  );
  const panX = smoothKeyframeExpr(kfs.map((k) => ({ t: k.t, v: clampPan(k.panX) })), "t");
  const panY = smoothKeyframeExpr(kfs.map((k) => ({ t: k.t, v: clampPan(k.panY) })), "t");

  let zoomExpr = zoomBase;
  if (motion.beatPulse > 0 && motion.beats.length >= 2) {
    const pulseG = gaussSumExpr(motion.beats, 0.13, "t");
    zoomExpr = `(${zoomExpr})*(1+(${motion.beatPulse.toFixed(4)})*${pulseG})`;
  }
  if (punch) {
    const g = gaussSumExpr([punch.at], 0.16, "t");
    zoomExpr = `(${zoomExpr})*(1+(${punch.strength.toFixed(4)})*${g})`;
  }
  const inv = clampExpr(`(${zoomExpr}-1)/${(maxZoom - 1).toFixed(4)}`, 0, 1);
  const ow = Math.round((W * maxZoom) / 2) * 2;
  const oh = Math.round((H * maxZoom) / 2) * 2;

  const shakeX = shakeExpr(motion.shake.at, motion.shake.strength * 22);
  const shakeY = shakeExpr(motion.shake.at, motion.shake.strength * 14);

  const cropXExpr = `(0.5+0.5*${panX}*${inv})*${ow - W}+${shakeX}`;
  const cropYExpr = `(0.5+0.5*${panY}*${inv})*${oh - H}+${shakeY}`;

  return { maxZoom, ow, oh, cropXExpr, cropYExpr, zoomExpr };
}

/**
 * Emit the camera chain (pre-scale → animated crop) onto `parts`:
 * [base] → scale to overscan → crop=W:H (per-frame x/y) → [cam].
 */
export function emitCameraChain(
  parts: string[],
  exprs: Omit<CameraResult, "ref">,
  W: number,
  H: number,
  baseRef: string
): CameraResult {
  parts.push(
    `${baseRef}scale=${exprs.ow}:${exprs.oh}[mcam0]`,
    `[mcam0]crop=w=${W}:h=${H}:x='${exprs.cropXExpr}':y='${exprs.cropYExpr}'[cam]`
  );
  return { ...exprs, ref: "[cam]" };
}

/**
 * Append the camera chain to `parts`:
 * [base] → scale to overscan → crop=W:H (per-frame x/y) → [cam].
 */
export function buildCameraChain(
  parts: string[],
  motion: MotionSpec,
  W: number,
  H: number,
  durationSec: number,
  baseRef: string
): CameraResult {
  void durationSec;
  const exprs = computeCameraExpressions(motion, W, H);
  return emitCameraChain(parts, exprs, W, H, baseRef);
}

function clampPan(v: number): number {
  return Math.min(1, Math.max(-1, v));
}

// ---------------------------------------------------------------------------
// Text tracks (2D/3D text animation, kinetic typography, subject tracking)
// ---------------------------------------------------------------------------

export interface TextTrackContext {
  W: number;
  H: number;
  durationSec: number;
  fps: number;
  font: string | null;
  /** Subject track for follow/layering (may be unavailable). */
  subject: SubjectTrack | null;
  camera: Omit<CameraResult, "ref"> | null;
  parts: string[];
}

export interface TextTrackResult {
  /** Transparent layer label with the rendered text + entrance transforms. */
  ref: string;
  /** Transforms still needed at overlay time (y expression etc.). */
  yExpr: string;
  xExpr: string;
  start: number;
  end: number;
}

/**
 * Build one text track (drawtexts → entrance transform → static tilt).
 * The caller overlays it at the right layer depth (behind/front subject).
 */
export function buildTextTrack(track: TextTrackContext, text: TextOverlay, td: MotionText3D): TextTrackResult {
  const { W, H, durationSec, fps, font, parts } = track;
  const start = text.startSec ?? 0;
  const end = text.endSec ?? durationSec;
  const idx = parts.length;
  const ref = `[txt${idx}]`;
  if (!font) {
    return { ref: "", yExpr: "0", xExpr: "0", start, end };
  }
  const fs = Math.round(text.fontSize * (W / 1080));
  const borderW = Math.max(2, Math.round(4 * (W / 1080)));
  const yBase = H * (text.y / 100);
  const words = text.text.trim().split(/\s+/).filter(Boolean);
  const kinetic = td.kinetic && words.length >= 2;
  const step = 0.12;

  // Layer canvas.
  const layer: string[] = [`color=black@0:s=${W}x${H}:r=${fps},format=rgba`];

  // Extrusion: darker copies sliding behind.
  if (td.depth > 0) {
    const dark = darken(text.color, 0.52);
    for (let i = td.depth; i >= 1; i--) {
      const dx = Math.round(i * 2.6);
      const dy = Math.round(i * 1.6);
      layer.push(
        `drawtext=fontfile='${escapeDrawText(font)}':text='${escapeDrawText(text.text)}'` +
          `:fontsize=${fs}:fontcolor=${dark}:borderw=0` +
          `:x=(w-text_w)/2+${dx}:y=(h-text_h)/2+${dy}` +
          `:alpha='${entranceAlphaExpr(td, start, step, kinetic ? words.length : 0)}'`
      );
    }
  }

  // Kinetic word-by-word prefixes (later prefixes cover earlier ones).
  if (kinetic) {
    for (let i = 0; i < words.length; i++) {
      const prefix = words.slice(0, i + 1).join(" ");
      const alpha = `min(1,(t-(${start.toFixed(3)}+${(i * step).toFixed(3)}))/0.13)`;
      layer.push(
        `drawtext=fontfile='${escapeDrawText(font)}':text='${escapeDrawText(prefix)}'` +
          `:fontsize=${fs}` +
          `:fontcolor=${text.color}:borderw=${borderW}:bordercolor=${text.strokeColor}@0.85` +
          `:x=(w-text_w)/2:y=(h-text_h)/2` +
          `:alpha='${alpha}'`
      );
    }
    // Accent copy (emphasis words stay accent-colored for the whole line).
    if (td.accent && text.emphasis?.length) {
      const alpha = `min(1,(t-(${start.toFixed(3)}+${((words.length - 1) * step + step).toFixed(3)}))/0.13)`;
      layer.push(
        `drawtext=fontfile='${escapeDrawText(font)}':text='${escapeDrawText(text.text)}'` +
          `:fontsize=${fs}` +
          `:fontcolor=0xFFD60A:borderw=${borderW + 1}:bordercolor=${text.strokeColor}@0.9` +
          `:x=(w-text_w)/2:y=(h-text_h)/2` +
          `:alpha='${alpha}'`
      );
    }
  } else {
    const alpha = entranceAlphaExpr(td, start, step, 0);
    layer.push(
      `drawtext=fontfile='${escapeDrawText(font)}':text='${escapeDrawText(text.text)}'` +
        `:fontsize=${fs}` +
        `:fontcolor=${text.color}:borderw=${borderW}:bordercolor=${text.strokeColor}@0.85` +
        `:x=(w-text_w)/2:y=(h-text_h)/2` +
        `:alpha='${alpha}'`
    );
    if (td.accent && text.emphasis?.length) {
      layer.push(
        `drawtext=fontfile='${escapeDrawText(font)}':text='${escapeDrawText(text.text)}'` +
          `:fontsize=${fs}` +
          `:fontcolor=0xFFD60A:borderw=${borderW + 1}:bordercolor=${text.strokeColor}@0.9` +
          `:x=(w-text_w)/2:y=(h-text_h)/2` +
          `:alpha='${alpha}'`
      );
    }
  }
  let chain = layer.join(",");
  // Entrance transforms (scale/rotate on the whole track).
  chain += entranceTransforms(td, start);
  // Static 3D tilt (perspective).
  if (td.rotateX !== 0 || td.rotateY !== 0) {
    chain += `,${perspectiveTilt(td, W, H)}`;
  }
  parts.push(`${chain}${ref}`);

  // Overlay position.
  let xExpr: string;
  let yExpr: string;
  if (td.follow && track.subject?.available) {
    const sx = trackExpr(track.subject, (s) => s.cx, track.durationSec);
    const sy = trackExpr(track.subject, (s) => s.cy, track.durationSec);
    if (track.camera) {
      // Map the pre-scaled track position through the camera window.
      xExpr = `(${sx}*${track.camera.ow}-(${track.camera.cropXExpr}))-overlay_w/2`;
      yExpr = `(${sy}*${track.camera.oh}-(${track.camera.cropYExpr}))-overlay_h/2`;
    } else {
      xExpr = `(${sx})*main_w-overlay_w/2`;
      yExpr = `(${sy})*main_h-overlay_h/2`;
    }
  } else {
    xExpr = "(main_w-overlay_w)/2";
    let y = yBase.toFixed(2);
    if (td.entrance === "rise3d") {
      y = `(${yBase.toFixed(2)})+${(H * 0.4).toFixed(1)}*pow(max(0,1-min(1,max(0,t-${start.toFixed(3)})/0.5)),2)`;
    }
    yExpr = y;
  }
  return { ref, yExpr, xExpr, start, end };
}

/** Alpha for entrance: fade = ramp; everything else reveals via transform. */
function entranceAlphaExpr(td: MotionText3D, start: number, step: number, kineticWords: number): string {
  if (td.entrance === "fade" && kineticWords === 0) {
    return `min(1,max(0,(t-${start.toFixed(3)})/0.4))`;
  }
  return "1";
}

/** Per-track transform chain for the entrance animation. */
function entranceTransforms(td: MotionText3D, start: number): string {
  const x = `min(1,max(0,t-${start.toFixed(3)})/0.4)`;
  switch (td.entrance) {
    case "slam":
      // Ease-out scale 1.45 → 1.0 (smoothstep).
      return `,scale=w='iw*(1.45-0.45*(${x}*${x}*(3-2*${x})))':h='ih*(1.45-0.45*(${x}*${x}*(3-2*${x})))':eval=frame`;
    case "flip":
      // Edge-on → full (scale-x reveal + slight y squeeze).
      return `,scale=w='iw*abs(sin(min(1,max(0,t-${start.toFixed(3)})/0.42)*PI/2))':h='ih*(0.88+0.12*min(1,max(0,t-${start.toFixed(3)})/0.42))':eval=frame`;
    case "spin":
      return `,rotate=a='2*PI*min(1,max(0,t-${start.toFixed(3)})/0.7)':c=black@0:ow=iw:oh=ih` +
        `,scale=w='iw*(0.85+0.15*${x})':h='ih*(0.85+0.15*${x})':eval=frame`;
    case "rise3d":
      return `,rotate=a='(${x}*0.12-0.12)':c=black@0:ow=iw:oh=ih`;
    case "fade":
    case "none":
    default:
      return "";
  }
}

/** Static pseudo-3D perspective tilt for a text layer. */
function perspectiveTilt(td: MotionText3D, W: number, H: number): string {
  const rY = (td.rotateY * Math.PI) / 180;
  const rX = (td.rotateX * Math.PI) / 180;
  const kY = Math.min(0.45, Math.abs(Math.sin(rY)));
  const kX = Math.min(0.45, Math.abs(Math.sin(rX)));
  const x0 = W * kY;
  const x1 = W - W * kY;
  const y0 = H * kX;
  const y2 = H - H * kX;
  return `perspective=x0=${x0.toFixed(1)}:y0=${y0.toFixed(1)}:x1=${x1.toFixed(1)}:y1=${y0.toFixed(1)}:x2=${x0.toFixed(1)}:y2=${y2.toFixed(1)}:x3=${x1.toFixed(1)}:y3=${y2.toFixed(1)}`;
}

/** Subsample the subject track into a smooth expression (max ~28 samples). */
export function trackExpr(
  track: SubjectTrack,
  pick: (s: SubjectTrack["samples"][number]) => number,
  durationSec: number
): string {
  const s = track.samples;
  if (!s.length) return "0.5";
  const maxSamples = 28;
  const stride = Math.max(1, Math.ceil(s.length / maxSamples));
  const keys: { t: number; v: number }[] = [];
  for (let i = 0; i < s.length; i += stride) {
    keys.push({ t: s[i].t, v: clamp01(pick(s[i])) });
  }
  const last = s[s.length - 1];
  keys.push({ t: Math.min(durationSec, last.t + 0.5), v: clamp01(pick(last)) });
  return smoothKeyframeExpr(keys);
}

/**
 * Overlay a built text track onto `baseRef` with its time window and
 * entrance position. Appends the graph part and returns the new label.
 */
export function overlayText(
  parts: string[],
  baseRef: string,
  track: TextTrackResult,
  label: string
): string {
  if (!track.ref) return baseRef;
  const enable = `enable='between(t,${track.start.toFixed(3)},${Math.max(track.start + 0.01, track.end).toFixed(3)})'`;
  parts.push(
    `${baseRef}${track.ref}overlay=x='${track.xExpr}':y='${track.yExpr}':${enable}${label}`
  );
  return label;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function darken(hex: string, factor: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return "0x444444";
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `0x${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Overlays (grain, letterbox, glow, rays, particles, flashes, vignette)
// ---------------------------------------------------------------------------

/** Apply the overlay stack onto `baseRef`; returns the new label. */
export function applyOverlays(
  parts: string[],
  motion: MotionSpec,
  baseRef: string,
  W: number,
  H: number,
  fps: number,
  durationSec: number
): string {
  const o = motion.overlays;
  let cur = baseRef;

  // Glow: screen-blend a heavily blurred copy.
  if (o.glow && o.glow.strength > 0) {
    const strength = Math.min(0.55, o.glow.strength * 0.5);
    parts.push(
      `${cur}split[gl0][gl1]`,
      `[gl0]gblur=sigma=16[glb]`,
      `[gl1][glb]blend=all_mode=screen:all_opacity=${strength.toFixed(3)}[glx]`
    );
    cur = "[glx]";
  }

  // Light rays: slowly rotating blurred light bands, screen-blended.
  if (o.rays && o.rays.strength > 0) {
    const opacity = Math.min(0.35, o.rays.strength * 0.22);
    parts.push(
      `color=black@0:s=${W}x${H}:r=${fps},format=rgba,` +
        `drawbox=x=0:y=${Math.round(H * 0.5)}:w=${W}:h=${Math.round(H * 0.045)}:color=white:t=fill,` +
        `rotate=a='0.9*sin(0.25*t)':c=black@0:ow=${W}:oh=${H},` +
        `gblur=sigma=${Math.round(H * 0.028)},eq=brightness=1.1,` +
        `drawbox=x=0:y=${Math.round(H * 0.05)}:w=${W}:h=${Math.round(H * 0.03)}:color=white:t=fill,` +
        `rotate=a='-0.6*sin(0.21*t+1.2)':c=black@0:ow=${W}:oh=${H},` +
        `gblur=sigma=${Math.round(H * 0.02)}[rays0]`,
      `[${cur.slice(1, -1)}][rays0]blend=all_mode=screen:all_opacity=${opacity.toFixed(3)}[raysx]`
    );
    cur = "[raysx]";
  }

  // Particles: animated film dust / sparks (screen-blended noise).
  if (o.particles) {
    const p = o.particles;
    if (p.kind === "spark") {
      const opacity = Math.min(0.4, p.density * 0.26);
      parts.push(
        `color=black@0:s=${W}x${H}:r=${fps},format=rgba,noise=alls=40:allf=t+u,gblur=sigma=0.8,eq=brightness=2.1[spk1]`,
        `[${cur.slice(1, -1)}][spk1]blend=all_mode=screen:all_opacity=${opacity.toFixed(3)}[spkx]`,
        `color=c=${darken(p.color, 1)}:s=${W}x${H}:r=${fps}[spkC2]`,
        `[spkx][spkC2]blend=all_mode=screen:all_opacity=${(opacity * 0.55).toFixed(3)}[spky]`
      );
      cur = "[spky]";
    } else {
      const density = Math.min(0.5, p.density * 0.32);
      parts.push(
        `color=black@0:s=${W}x${H}:r=${fps},format=rgba,noise=alls=26:allf=t+u,gblur=sigma=1.4,eq=brightness=1.35[par0]`,
        `[${cur.slice(1, -1)}][par0]blend=all_mode=screen:all_opacity=${density.toFixed(3)}[parx]`
      );
      cur = "[parx]";
    }
  }

  // Letterbox bars.
  if (o.letterbox) {
    const bh = Math.round(H * 0.09);
    parts.push(
      `${cur}drawbox=x=0:y=0:w=${W}:h=${bh}:color=black:t=fill,` +
        `drawbox=x=0:y=${H - bh}:w=${W}:h=${bh}:color=black:t=fill[lbx]`
    );
    cur = "[lbx]";
  }

  // Cinematic vignette.
  if (o.vignette > 0) {
    const angle = Math.PI / Math.max(1.5, 5 - 3.5 * o.vignette);
    parts.push(`${cur}vignette=${angle.toFixed(4)}[vgx]`);
    cur = "[vgx]";
  }

  // Film grain.
  if (o.grain > 0) {
    parts.push(`${cur}noise=alls=${Math.min(100, Math.round(o.grain * 26))}:allf=t+u[grx]`);
    cur = "[grx]";
  }

  // Flashes (transitions/impacts) — full-screen white/black pulses.
  // NOTE: the overlay second input must NOT use setpts (frames get dropped by
  // overlay in ffmpeg 6.1) — instead the flash canvas is padded into the
  // right spot with tpad (transparent start frames), then eof_action=pass
  // lets the main video continue cleanly after the flash ends.
  const flashList = [
    ...(o.flashes ?? []),
    ...(motion.transitions?.flashAt ?? []).map((at) => ({ at, color: "white" as const })),
  ];
  if (flashList.length) {
    for (let i = 0; i < flashList.length; i++) {
      const f = flashList[i];
      const at = Math.min(Math.max(0.05, f.at), Math.max(0.1, durationSec - 0.35));
      const color = f.color === "black" ? "black" : "white";
      parts.push(
        `color=${color}:d=0.4:s=${W}x${H}:r=${fps},format=rgba,` +
          `fade=t=in:st=0:d=0.1:alpha=1,fade=t=out:st=0.22:d=0.18:alpha=1,` +
          `tpad=start_duration=${at.toFixed(3)}:start_mode=add:color=black@0[fl${i}]`,
        `[${cur.slice(1, -1)}][fl${i}]overlay=0:0:eof_action=pass[flx${i}]`
      );
      cur = `[flx${i}]`;
    }
  }

  return cur;
}

// ---------------------------------------------------------------------------
// Segments (speed ramps + transitions)
// ---------------------------------------------------------------------------

export interface SegmentBuildResult {
  videoRef: string;
  audioRef: string | null;
  totalDuration: number;
  /** True when pieces were non-trivial (multi-piece or speed-changed). */
  remapped: boolean;
}

/**
 * Build the video+audio for a piece list. When xfade transitions are on and
 * there are multiple pieces, video is chained with xfade (audio with
 * acrossfade) so the seam stays smooth and in sync.
 */
export function buildSegments(
  parts: string[],
  pieces: RenderPiece[],
  opts: {
    W: number;
    H: number;
    fps: number;
    xfade: boolean;
    hasAudio: boolean;
    outFps: number;
    preview: boolean;
  }
): SegmentBuildResult {
  const { W, H, fps, xfade, hasAudio, outFps, preview } = opts;
  if (pieces.length === 0) {
    throw new Error("No render pieces produced.");
  }
  const single = pieces.length === 1 && pieces[0].factor === 1;
  if (single) {
    return {
      videoRef: "",
      audioRef: null,
      totalDuration: pieceFinalDuration(pieces[0]),
      remapped: false,
    };
  }

  const total = pieces.reduce((a, p) => a + pieceFinalDuration(p), 0);
  const vLabels: string[] = [];
  const aLabels: string[] = [];

  pieces.forEach((p, i) => {
    const factor = clampF(p.factor);
    let v = `[0:v]trim=start=${p.start.toFixed(3)}:end=${p.end.toFixed(3)},setpts=PTS-STARTPTS`;
    if (factor < 1) {
      v += `,setpts=PTS/${factor.toFixed(3)}`;
      if (factor <= 0.6 && !preview) v += `,minterpolate=fps=${outFps}:mi_mode=blend`;
      else v += `,fps=${outFps}`;
    } else if (factor > 1) {
      v += `,setpts=PTS/${factor.toFixed(3)},fps=${outFps}`;
    } else {
      v += `,fps=${outFps}`;
    }
    v += `,scale=${W}:${H}`;
    const vL = `[pv${i}]`;
    vLabels.push(vL);
    parts.push(`${v}${vL}`);

    if (hasAudio) {
      let a = `[0:a]atrim=start=${p.start.toFixed(3)}:end=${p.end.toFixed(3)},asetpts=PTS-STARTPTS`;
      if (factor !== 1) {
        // atempo chain (0.5..2 per step).
        let remaining = factor;
        const steps: number[] = [];
        while (remaining > 2) {
          steps.push(2);
          remaining /= 2;
        }
        while (remaining < 0.5) {
          steps.push(0.5);
          remaining /= 0.5;
        }
        steps.push(remaining);
        a += steps.map((s) => `,atempo=${s.toFixed(3)}`).join("");
      }
      const aL = `[pa${i}]`;
      aLabels.push(aL);
      parts.push(`${a}${aL}`);
    }
  });

  // Video concat or xfade chain.
  let videoRef: string;
  if (xfade && vLabels.length > 1) {
    const trans = "fade";
    const cover = 0.22;
    let offset = 0;
    let prev = vLabels[0];
    for (let i = 1; i < vLabels.length; i++) {
      const outLabel = i === vLabels.length - 1 ? "[mv]" : `[x${i}]`;
      offset += pieceFinalDuration(pieces[i - 1]) - cover;
      parts.push(`${prev}${vLabels[i]}xfade=transition=${trans}:duration=${cover.toFixed(3)}:offset=${offset.toFixed(3)}${outLabel}`);
      prev = outLabel;
    }
    videoRef = prev;
  } else {
    parts.push(`${vLabels.join("")}concat=n=${vLabels.length}:v=1:a=0[mv]`);
    videoRef = "[mv]";
  }

  // Audio concat or acrossfade chain.
  let audioRef: string | null = null;
  if (hasAudio && aLabels.length) {
    if (xfade && aLabels.length > 1) {
      const cover = 0.22;
      let prev = aLabels[0];
      for (let i = 1; i < aLabels.length; i++) {
        const outLabel = i === aLabels.length - 1 ? "[ma]" : `[ax${i}]`;
        parts.push(`${prev}${aLabels[i]}acrossfade=d=${cover.toFixed(3)}:c1=tri:o=0${outLabel}`);
        prev = outLabel;
      }
      audioRef = prev;
    } else {
      parts.push(`${aLabels.join("")}concat=n=${aLabels.length}:v=0:a=1[ma]`);
      audioRef = "[ma]";
    }
  }

  return { videoRef, audioRef, totalDuration: total, remapped: !single };
}

// ---------------------------------------------------------------------------
// Re-exported helpers used by tests/editor
// ---------------------------------------------------------------------------

export function specToPieces(spec: EditSpec, motion: MotionSpec, sourceDuration: number): RenderPiece[] {
  const trimStart = spec.trim?.start ?? 0;
  const trimEnd = spec.trim?.end ?? null;
  return buildPieces({
    trimStart,
    trimEnd,
    cuts: spec.cuts ?? null,
    ramps: motion.speedRamps,
    sourceDuration,
  });
}
