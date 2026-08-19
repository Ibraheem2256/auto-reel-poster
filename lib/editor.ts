import { spawn } from "child_process";
import { createWriteStream, mkdtempSync, promises as fs, readdirSync, statSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { randomInt } from "crypto";
import ffmpegPath from "ffmpeg-static";
import { streamVideoFromDrive } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/utils";
import {
  FILTER_PRESETS,
  defaultAudioEnhance,
  type EditSpec,
  type TextOverlay,
} from "@/lib/editor-spec";
import { synthesizeSfx } from "@/lib/ai-edit/sfx";
import {
  bgRemovalAvailable,
  cleanupMasks,
  extractPersonMasks,
  maskSequencePattern,
  probeFps,
  type BgRemovalResult,
} from "@/lib/bg-removal";
import {
  applyOverlays,
  buildSegments,
  buildTextTrack,
  computeCameraExpressions,
  emitCameraChain,
  overlayText,
  pieceFinalDuration,
  specToPieces,
  type RenderPiece,
  type TextTrackContext,
  type TextTrackResult,
} from "@/lib/motion/render";
import type { MotionText3D, SubjectTrack } from "@/lib/motion/types";

/**
 * Spec-driven video editor. Downloads the Drive video, applies the user's
 * edit spec (trim, filters, effects, text/motion-graphics overlays, music,
 * real background removal), and encodes H.264 + faststart. Returns the edited
 * file path (caller deletes it afterwards).
 */

const EDIT_TIMEOUT_MS = 15 * 60_000; // heavy edits (bg removal) can take a while
const MUSIC_DIR = resolve(process.cwd(), "music");
const MUSIC_VOLUME = 0.22; // ducked under the original audio
const FONT_CANDIDATES = [
  "C:/Windows/Fonts/arialbd.ttf",
  "C:/Windows/Fonts/arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
];
const OUT_W = 1080;
const OUT_H = 1920;
const PROGRESS_BAR_COLOR = "0xFF2D5590";

export interface EditResult {
  filePath: string;
  durationMs: number;
  width: number;
  height: number;
  musicTrack: string | null;
  bgRemoved: boolean;
}

function findFont(): string | null {
  for (const f of FONT_CANDIDATES) {
    try {
      statSync(f);
      return f;
    } catch {
      // try next
    }
  }
  return null;
}

function listMusicTracks(): string[] {
  try {
    return readdirSync(MUSIC_DIR)
      .filter((f) => /\.(mp3|m4a|wav|ogg)$/i.test(f))
      .map((f) => join(MUSIC_DIR, f))
      .filter((f) => {
        try {
          return statSync(f).size > 50_000; // skip tiny/corrupt files
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

export function listMusicTrackNames(): string[] {
  return listMusicTracks().map((f) => f.replace(/\\/g, "/").split("/").pop() ?? "");
}

export function musicTrackExists(name: string): boolean {
  return listMusicTrackNames().includes(name);
}

/** Escape a string for use inside an ffmpeg drawtext filter. */
export function escapeDrawText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/\n/g, " ")
    .slice(0, 60);
}

interface ProbeResult {
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  fps: number;
}

function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not found.");
  const binary: string = ffmpegPath;
  return new Promise((resolvePromise, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc = spawn(binary, args, { windowsHide: true }) as any;
    let stderr = "";
    proc.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    const timeout = setTimeout(() => proc.kill("SIGKILL"), EDIT_TIMEOUT_MS);
    proc.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.on("close", (code: number) => {
      clearTimeout(timeout);
      resolvePromise({ code: code ?? -1, stderr });
    });
  });
}

/** Probe the source video for duration / dimensions / audio stream. */
export async function probeVideo(filePath: string): Promise<ProbeResult> {
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", filePath]);
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durSec = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : 0;
  const videoMatch = stderr.match(/Stream #\d+:\d+.*Video:.*?(\d{2,5})x(\d{2,5})/);
  const fpsMatch = stderr.match(/(\d+(?:\.\d+)?)\s*fps/);
  return {
    durationMs: Math.round(durSec * 1000),
    width: videoMatch ? Number(videoMatch[1]) : 1080,
    height: videoMatch ? Number(videoMatch[2]) : 1920,
    hasAudio: /Audio:\s*(aac|mp3|opus|vorbis|pcm)/.test(stderr),
    fps: fpsMatch && Number(fpsMatch[1]) > 0 && Number(fpsMatch[1]) <= 120 ? Number(fpsMatch[1]) : 30,
  };
}

// ---------------------------------------------------------------------------
// Filter graph builders
// ---------------------------------------------------------------------------

function scaleToCanvas(isPortrait: boolean, w: number, h: number): string[] {
  if (isPortrait) {
    // Already vertical: fit to canvas, letterbox if odd aspect.
    return [
      `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`,
    ];
  }
  // Landscape: center-crop to 9:16.
  return [`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`];
}

function effectFilters(effects: string[] | undefined, w: number, h: number): string[] {
  const out: string[] = [];
  for (const e of effects ?? []) {
    switch (e) {
      case "zoom-intro":
        out.push(`zoompan=z='min(1+0.004*on,1.24)':d=1:fps=30:s=${w}x${h}`);
        break;
      case "ken-burns":
        out.push(`zoompan=z='min(1+0.0012*on,1.12)':d=1:fps=30:s=${w}x${h}`);
        break;
      case "shake":
        // Note: this ffmpeg build's crop has no `eval` option, but x/y are
        // evaluated per-frame by default — never pass eval=frame here.
        out.push(
          `crop=w='iw-80':h='ih-80':x='40+30*sin(n/1.5)':y='40+30*cos(n/2.1)'`,
          `scale=${w}:${h}`
        );
        break;
      case "bounce":
        out.push(
          `crop=w='iw':h='ih-60':x=0:y='30+20*abs(sin(n/2.3))'`,
          `scale=${w}:${h}`
        );
        break;
      default:
        break;
    }
  }
  return out;
}

function filterChain(spec: EditSpec): string[] {
  const out: string[] = [];
  const preset = spec.filter && spec.filter !== "none" ? FILTER_PRESETS[spec.filter] : [];
  out.push(...preset);
  const cf = spec.customFilter;
  if (cf) {
    const parts: string[] = [];
    if (cf.brightness !== 0) parts.push(`brightness=${(cf.brightness * 0.5).toFixed(3)}`);
    if (cf.contrast !== 0) parts.push(`contrast=${(1 + cf.contrast * 0.5).toFixed(3)}`);
    if (cf.saturation !== 0) parts.push(`saturation=${(1 + cf.saturation).toFixed(3)}`);
    if (cf.hue !== 0) parts.push(`hue=h=${cf.hue}`);
    if (parts.length) out.push(`eq=${parts.join(":")}`);
    if (cf.vignette > 0) {
      const angle = Math.PI / Math.max(1.5, 5 - 3.5 * cf.vignette);
      out.push(`vignette=${angle.toFixed(4)}`);
    }
    if (cf.blur > 0) out.push(`gblur=sigma=${cf.blur.toFixed(2)}`);
  }
  return out;
}

function textFilters(
  texts: TextOverlay[],
  font: string | null,
  durationSec: number,
  w: number,
  h: number
): string[] {
  if (!font || texts.length === 0) return [];
  const out: string[] = [];
  for (const t of texts) {
    const start = t.startSec ?? 0;
    const end = t.endSec ?? durationSec;
    const yBase = `h*${(t.y / 100).toFixed(3)}`;
    let yExpr = yBase;
    let alphaExpr: string | undefined;
    if (t.animation === "fade-in") {
      alphaExpr = `min(1,(t-${start.toFixed(2)})/0.5)`;
    } else if (t.animation === "slide-up") {
      yExpr = `${yBase}+max(0,(t-${start.toFixed(2)})*160)`;
      alphaExpr = `min(1,(t-${start.toFixed(2)})/0.35)`;
    } else if (t.animation === "pop") {
      alphaExpr = `1/(1+exp(-((t-${start.toFixed(2)})-0.15)*14))`;
    }
    const fsScale = w / OUT_W;
    const fs = Math.round(t.fontSize * fsScale);
    const borderW = Math.max(2, Math.round(4 * fsScale));
    const enable = `enable='between(t,${start.toFixed(2)},${Math.max(start + 0.01, end).toFixed(2)})'`;
    let f =
      `drawtext=fontfile='${escapeDrawText(font)}':text='${escapeDrawText(t.text)}'` +
      `:fontsize=${fs}` +
      `:fontcolor=${t.color}:borderw=${borderW}:bordercolor=${t.strokeColor}@0.85` +
      `:x=(w-text_w)/2:y='${yExpr}'`;
    if (alphaExpr) f += `:alpha='${alphaExpr}'`;
    f += `:${enable}`;
    out.push(f);
    // Keyword emphasis: the same glyphs drawn again in an accent color on top.
    if (t.emphasis?.length) {
      let ef =
        `drawtext=fontfile='${escapeDrawText(font)}':text='${escapeDrawText(t.text)}'` +
        `:fontsize=${fs}` +
        `:fontcolor=0xFFD60A:borderw=${borderW + 1}:bordercolor=${t.strokeColor}@0.9` +
        `:x=(w-text_w)/2:y='${yExpr}'`;
      if (alphaExpr) ef += `:alpha='${alphaExpr}'`;
      ef += `:${enable}`;
      out.push(ef);
    }
  }
  return out;
}

function motionGraphicFilters(spec: EditSpec, durationSec: number, w: number): string[] {
  const out: string[] = [];
  if (spec.progressBar) {
    const barH = Math.max(8, Math.round(18 * (w / OUT_W)));
    out.push(
      `drawbox=x=0:y=h-${barH}:w='iw*clip(t/${durationSec.toFixed(2)},0,1)':h=${barH}:color=${PROGRESS_BAR_COLOR}:t=fill:eval=frame`
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export interface EditVideoOptions {
  workspaceId: string;
  driveFileId: string;
  hookText: string;
  durationMs?: number | null;
  spec?: EditSpec | null;
  /** Preview renders use half resolution + faster encode. */
  preview?: boolean;
  /** Hard cap on output length in seconds (previews). */
  maxSeconds?: number;
  /** Internal/testing: render a local file instead of downloading from Drive. */
  sourceFileOverride?: string;
  onStage?: (stage: string, pct?: number) => void;
}

async function downloadSource(opts: EditVideoOptions, tempDir: string): Promise<string> {
  if (opts.sourceFileOverride) return opts.sourceFileOverride;
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

/**
 * Edit the video for short-form platforms. Returns the edited file path.
 * The caller is responsible for deleting the returned file (cleanupEditedFile).
 */
export async function editVideoForPublish(opts: EditVideoOptions): Promise<EditResult> {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not found.");

  const spec: EditSpec = opts.spec ?? {};
  const font = findFont();
  const isPreview = opts.preview === true;
  const outW = isPreview ? 540 : OUT_W;
  const outH = isPreview ? 960 : OUT_H;

  let tempDir: string | null = null;
  let masksDir: string | null = null;
  try {
    // 1. Download the Drive file to a seekable temp file.
    opts.onStage?.("download");
    tempDir = mkdtempSync(join(tmpdir(), "arp-edit-"));
    const sourceFile = await downloadSource(opts, tempDir);

    // 2. Probe for real duration / dimensions (fall back to stored metadata).
    const probe = await probeVideo(sourceFile);
    const sourceDurationSec = probe.durationMs / 1000 || (opts.durationMs ?? 60_000) / 1000 || 60;

    // 5. Compute duration (smart cuts override the simple trim).
    const bg = spec.background;
    const motion = spec.motion && spec.motion.enabled ? spec.motion : null;
    const rawCuts =
      (spec.cuts ?? []).length > 0 && bg?.remove !== true && !motion ? (spec.cuts ?? []) : null;
    const cuts = rawCuts
      ?.map((c) => ({
        start: Math.max(0, c.start),
        end: Math.min(sourceDurationSec, c.end),
      }))
      .filter((c) => c.end - c.start >= 0.3);

    const pace = spec.pacing && spec.pacing >= 0.7 && spec.pacing <= 1.4 ? spec.pacing : 1;
    const trimStart = spec.trim?.start ?? 0;
    const trimEnd = spec.trim?.end ?? null;

    // Motion engine: pieces = cuts + speed ramps on the source timeline.
    let pieces: RenderPiece[] | null = null;
    if (motion) {
      pieces = specToPieces(spec, motion, sourceDurationSec);
    }
    const usePieces = pieces !== null && pieces.length > 0 && (pieces.length > 1 || pieces[0].factor !== 1);

    let durationSec: number;
    if (pieces && pieces.length) {
      durationSec = pieces.reduce((sum, p) => sum + pieceFinalDuration(p), 0) / pace;
    } else if (cuts) {
      durationSec = cuts.reduce((sum, c) => sum + (c.end - c.start), 0);
      durationSec /= pace;
    } else if (trimEnd) {
      durationSec = Math.max(trimEnd - trimStart, 0.5) / pace;
    } else {
      durationSec = Math.max(sourceDurationSec - trimStart, 0.5) / pace;
    }
    if (opts.maxSeconds) durationSec = Math.min(durationSec, opts.maxSeconds);
    durationSec = Math.max(0.5, durationSec);
    const durationMs = Math.round(durationSec * 1000);
    const isPortrait = probe.height >= probe.width;
    const hasAudio = probe.hasAudio;
    const fps = probe.fps;

    // 6. Pick music track.
    let musicTrack: string | null = null;
    const specMusic = spec.music;
    if (specMusic?.track) {
      musicTrack = listMusicTracks().find(
        (f) => (f.replace(/\\/g, "/").split("/").pop() ?? "") === specMusic.track
      ) ?? null;
    } else if (!specMusic) {
      // Legacy behaviour (no spec.music): pick a random CC0 track.
      const tracks = listMusicTracks();
      musicTrack = tracks.length ? tracks[randomInt(tracks.length)] : null;
    }
    const musicVolume = specMusic?.volume ?? MUSIC_VOLUME;
    const musicFadeIn = specMusic?.fadeInSec ?? 1;
    const musicFadeOut = specMusic?.fadeOutSec ?? 2;
    const audio = spec.audio ?? defaultAudioEnhance();

    // 7. Background removal / subject masks (real person cut-out via RVM).
    //    Motion graphics also need subject masks for parallax/behind/follow.
    const wantSubject =
      (bg?.remove === true || motion?.needsSubject === true) && !rawCuts;
    const subjectTrimStart =
      pieces && pieces.length === 1 ? pieces[0].start : trimStart > 0 ? trimStart : undefined;
    const subjectUsable = wantSubject && (!usePieces || (pieces && pieces.length === 1 && pieces[0].factor === 1));
    let bgResult: BgRemovalResult | null = null;
    if (subjectUsable && bgRemovalAvailable()) {
      opts.onStage?.("bg-removal", 0);
      masksDir = join(tempDir, "masks");
      await fs.mkdir(masksDir, { recursive: true });
      // Matte at ~1/4 of the source resolution for speed; masks are upscaled.
      const matteW = Math.max(160, Math.round(probe.width * 0.25));
      const matteH = Math.max(288, Math.round(probe.height * 0.25));
      bgResult = await extractPersonMasks({
        sourceFile,
        masksDir,
        width: matteW,
        height: matteH,
        maxSeconds: opts.maxSeconds,
        trimStartSec: trimStart > 0 ? trimStart : undefined,
        onProgress: (done) => opts.onStage?.("bg-removal", done),
      });
    }

    // 8. Build filter chains.
    opts.onStage?.("edit");
    const chainParts: string[] = [];

    // --- Video: motion pieces or smart-cut segment concat, then the edit tail. ---
    let videoSource = "[0:v]";
    if (cuts && cuts.length) {
      cuts.forEach((c, i) => {
        chainParts.push(
          `[0:v]trim=start=${c.start.toFixed(3)}:end=${c.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`
        );
      });
      chainParts.push(
        `${cuts.map((_, i) => `[v${i}]`).join("")}concat=n=${cuts.length}:v=1:a=0[basev]`
      );
      videoSource = "[basev]";
    }

    // Motion engine: remap the source timeline into pieces (cuts + speed
    // ramps) with xfade transitions. When pieces are trivial (single full
    // window at factor 1) nothing is remapped — legacy -ss trim applies.
    let pieceAudioRef: string | null = null;
    if (motion && pieces && pieces.length && usePieces) {
      const seg = buildSegments(chainParts, pieces, {
        W: probe.width,
        H: probe.height,
        fps,
        xfade: motion.transitions?.xfade === true,
        hasAudio,
        outFps: 30,
        preview: isPreview,
      });
      if (seg.videoRef) videoSource = seg.videoRef;
      pieceAudioRef = seg.audioRef;
    }

    const scaleChain = scaleToCanvas(isPortrait, outW, outH);
    const fxChain = motion ? [] : effectFilters(
      spec.effects ?? (opts.spec === null || opts.spec === undefined ? ["zoom-intro"] : []),
      outW,
      outH
    );
    const filterChainFx = filterChain(spec);
    // Fall back to the legacy hook overlay when the spec has no texts.
    let textList = spec.texts ?? [];
    if (textList.length === 0 && opts.hookText?.trim()) {
      textList = [
        {
          id: "hook",
          text: opts.hookText.trim().slice(0, 60),
          fontSize: 54,
          color: "#ffffff",
          strokeColor: "#000000",
          y: 12,
          animation: "fade-in",
          startSec: 0,
          endSec: 2.5,
        },
      ];
    }
    const textChain = motion ? [] : textFilters(textList, font, durationSec, outW, outH);
    const mgChain = motionGraphicFilters(spec, durationSec, outW);

    const loopWrap = spec.loop === true;
    const loopFadeDur = loopWrap ? Math.min(0.5, Math.max(0.2, durationSec * 0.08)) : 0;
    const fadeIn = "fade=t=in:st=0:d=0.35";
    const fadeOut = loopWrap ? "" : `fade=t=out:st=${Math.max(0, durationSec - 0.6).toFixed(2)}:d=0.6`;
    const tailLabel = loopWrap ? "[tailv]" : "[v]";

    // --- Motion Graphics & Effects composition. ---
    let motionTail: string | null = null;
    if (motion && pieces && pieces.length) {
      const W = probe.width;
      const H = probe.height;
      const camExprs = computeCameraExpressions(motion, W, H);
      const subject: SubjectTrack | null = motion.subjectTrack && motion.subjectTrack.length
        ? { available: true, samples: motion.subjectTrack }
        : null;
      const maskAvailable = Boolean(bgResult && subjectUsable);
      const bgStyle = bg?.remove === true ? (bg.style ?? "blur") : "blur";
      const bgColor = bg?.color ?? "#111827";
      const blurAmt = bg?.blurAmount ?? 40;
      const parallax = motion.parallax > 0 ? motion.parallax : 0;

      const txtCtx: TextTrackContext = {
        W,
        H,
        durationSec,
        fps,
        font,
        subject,
        camera: camExprs,
        parts: chainParts,
      };
      const tdFor = (id: string): MotionText3D =>
        motion.text3d[id] ?? {
          depth: 0,
          rotateX: 0,
          rotateY: 0,
          entrance: "fade",
          kinetic: false,
          follow: false,
          behind: false,
          accent: false,
        };

      // 1. Composite: background (parallax) + behind-subject texts + subject.
      let compLabel = videoSource;
      if (maskAvailable) {
        chainParts.push(`${videoSource}split[fgM][bgsrcM]`);
        if (bgStyle === "color") {
          chainParts.push(
            `color=c=0x${bgColor.replace("#", "")}:s=${W}x${H}:r=${fps}:format=rgba[bgM0]`
          );
        } else {
          chainParts.push(
            `[bgsrcM]boxblur=luma_radius=${blurAmt}:luma_power=2,format=rgba[bgM0]`
          );
        }
        let bgRef = "[bgM0]";
        if (parallax > 0) {
          const drift = Math.min(0.06, parallax * 0.05);
          chainParts.push(
            `[bgM0]scale=w='iw*max(1.0,(1+${drift.toFixed(3)}+0.02*sin(t/3.1)))':h='ih*max(1.0,(1+${drift.toFixed(3)}+0.02*cos(t/2.6)))':eval=frame,` +
              `crop=${W}:${H}:x='max(0,min(iw-${W},(iw-${W})/2+${(drift * W).toFixed(1)}*sin(t/4.2)))':y='max(0,min(ih-${H},(ih-${H})/2+${(drift * H).toFixed(1)}*cos(t/3.6)))'[bgP]`
          );
          bgRef = "[bgP]";
        }
        let n = 0;
        for (const [id, td] of Object.entries(motion.text3d)) {
          if (!td.behind) continue;
          const t = textList.find((x) => x.id === id);
          if (!t) continue;
          const tr = buildTextTrack(txtCtx, t, tdFor(id));
          bgRef = overlayText(chainParts, bgRef, tr, `[bgT${n}]`);
          n += 1;
        }
        chainParts.push(
          `[1:v]format=gray,scale=${W}:${H}[alM]`,
          `[fgM]format=rgba[fgAM]`,
          `[fgAM][alM]alphamerge[fgmM]`,
          `[${bgRef.slice(1, -1)}][fgmM]overlay=0:0[compM]`
        );
        compLabel = "[compM]";
      }

      // 2. Motion trails (tmix ghosting).
      if (motion.trails > 1) {
        chainParts.push(`${compLabel}tmix=frames=${motion.trails}[trM]`);
        compLabel = "[trM]";
      }

      // 3. Camera (overscale + animated crop).
      let camRef = emitCameraChain(chainParts, camExprs, W, H, compLabel).ref;

      // 4. Grade.
      if (filterChainFx.length) {
        chainParts.push(`${camRef}${filterChainFx.join(",")}[gradM]`);
        camRef = "[gradM]";
      }

      // 5. Overlays (glow / rays / particles / letterbox / vignette / grain / flashes).
      let ovRef = applyOverlays(chainParts, motion, camRef, W, H, fps, durationSec);

      // 6. Front texts (kinetic / 3D / follow).
      let n = 0;
      for (const [id, td] of Object.entries(motion.text3d)) {
        if (td.behind) continue;
        const t = textList.find((x) => x.id === id);
        if (!t) continue;
        const tr = buildTextTrack(txtCtx, t, tdFor(id));
        ovRef = overlayText(chainParts, ovRef, tr, `[ftM${n}]`);
        n += 1;
      }

      // 7. Tail: canvas scale, pacing, fades, progress bar.
      const paceFilter = pace !== 1 ? `setpts=PTS/${pace.toFixed(3)},` : "";
      const tailFilters = [...scaleChain, fadeIn, fadeOut, ...mgChain].filter(Boolean).join(",");
      motionTail = `${ovRef}${paceFilter}${tailFilters}${tailLabel}`;
    }

    let videoTail = [
      ...scaleChain,
      ...fxChain,
      ...filterChainFx,
      ...textChain,
      ...mgChain,
      fadeIn,
      fadeOut,
    ]
      .filter(Boolean)
      .join(",");

    if (pace !== 1) videoTail = `setpts=PTS/${pace.toFixed(3)},${videoTail}`;

    // --- Audio: voice chain (piece remap → noise reduction → pacing). ---
    const musicIdx = bgResult ? 2 : 1;
    const audioInputs: string[] = [];
    let voiceRef: string | null = null;
    if (hasAudio) {
      const voicePre: string[] = [];
      let voiceLabel: string | null = null;
      if (cuts && cuts.length) {
        cuts.forEach((c, i) => {
          chainParts.push(
            `[0:a]atrim=start=${c.start.toFixed(3)}:end=${c.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`
          );
        });
        chainParts.push(
          `${cuts.map((_, i) => `[a${i}]`).join("")}concat=n=${cuts.length}:v=0:a=1[basea]`
        );
        voicePre.push("[basea]");
        voiceLabel = "[basea]";
      } else if (motion && usePieces && pieceAudioRef) {
        voicePre.push(pieceAudioRef);
        voiceLabel = pieceAudioRef;
      } else {
        voicePre.push("[0:a]");
        voiceLabel = "[0:a]";
      }
      if (audio.highpass) voicePre.push("highpass=f=75");
      if (audio.noiseReduction) voicePre.push("afftdn=nf=-25");
      if (audio.deesser) voicePre.push("deesser=i=0.35");
      if (pace !== 1) voicePre.push(`atempo=${pace.toFixed(3)}`);
      voicePre.push("aresample=44100");
      const voiceFilters = voicePre.slice(1).join(",");
      if (voiceFilters) {
        chainParts.push(`${voiceLabel}${voiceFilters}[voice]`);
        voiceRef = "[voice]";
      } else {
        voiceRef = voiceLabel;
      }
    }
    if (loopWrap && voiceRef) {
      // Seamless audio loop: crossfade the ending back into the beginning.
      chainParts.push(`[voice]asplit[loopA1][loopA2]`);
      chainParts.push(
        `[loopA1][loopA2]acrossfade=d=${loopFadeDur.toFixed(3)},atrim=0:${durationSec.toFixed(3)},asetpts=PTS-STARTPTS[voiceLoop]`
      );
      voiceRef = "[voiceLoop]";
    }
    if (voiceRef) audioInputs.push(voiceRef);

    // --- Music with automatic ducking under the voice. ---
    // Note: sidechaincompress is unreliable in ffmpeg 6.1 (throws "Invalid
    // stream specifier"), so ducking uses a deterministic volume envelope
    // built from the speech windows detected during analysis.
    let musicRef: string | null = null;
    if (musicTrack) {
      const m: string[] = [];
      if (audio.ducking && voiceRef) {
        const windows = (audio.duckWindows ?? []).slice(0, 24);
        let expr = windows.length
          ? windows.map((w) => `between(t,${(w.startSec + 0.1).toFixed(2)},${(w.endSec - 0.1).toFixed(2)})`).join("+")
          : "0";
        // Use gt() — ffmpeg expr evaluator does not support the > operator.
        if (expr) expr = `if(gt(${expr},0),${(musicVolume * 0.45).toFixed(3)},${musicVolume.toFixed(3)})`;
        m.push(`volume='${expr || musicVolume.toFixed(3)}'`);
      } else {
        m.push(`volume=${musicVolume.toFixed(2)}`);
      }
      if (loopWrap) {
        // Seamless loop: music plays through without fades.
        m.push("aresample=44100");
      } else {
        const musicFadeOutAt = Math.max(0, durationSec - musicFadeOut).toFixed(2);
        m.push(
          `afade=t=in:st=0:d=${musicFadeIn.toFixed(2)}`,
          `afade=t=out:st=${musicFadeOutAt}:d=${musicFadeOut.toFixed(2)}`,
          "aresample=44100"
        );
      }
      // Prepend the music input stream label — without it ffmpeg rejects the filter_complex.
      chainParts.push(`[${musicIdx}:a]${m.join(",")}[music]`);
      musicRef = "[music]";
      audioInputs.push(musicRef);
    }

    // --- Synthesized SFX (zero-copyright, generated locally). ---
    const sfxList = (spec.sfx ?? []).filter((e) => e.at >= 0 && e.at <= durationSec);
    let sfxInputs = musicTrack ? musicIdx + 1 : musicIdx;
    for (let i = 0; i < sfxList.length; i++) {
      const e = sfxList[i];
      const sfxDir = join(tempDir, "sfx");
      await fs.mkdir(sfxDir, { recursive: true });
      const wavPath = join(sfxDir, `sfx${i}.wav`);
      await synthesizeSfx(e.type, wavPath);
      const delayMs = Math.round(e.at * 1000);
      chainParts.push(
        `[${sfxInputs}:a]aresample=44100,adelay=${delayMs}:all=1,volume=${e.volume.toFixed(2)}[sfx${i}]`
      );
      audioInputs.push(`[sfx${i}]`);
      sfxInputs += 1;
    }

    // --- Final mix + loudness normalization. ---
    let audioArgs: string[] = [];
    const target = audio.loudnessTarget ?? -14;
    if (audioInputs.length > 1) {
      chainParts.push(
        `${audioInputs.join("")}amix=inputs=${audioInputs.length}:duration=first:normalize=0,loudnorm=I=${target.toFixed(1)}:TP=-1.5:LRA=11,aresample=44100[aout]`
      );
      audioArgs = ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"];
    } else if (audioInputs.length === 1) {
      chainParts.push(`${audioInputs[0]}loudnorm=I=${target.toFixed(1)}:TP=-1.5:LRA=11[aout]`);
      audioArgs = ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"];
    }

    // --- Loop wrap (seamless: ending crossfades back into the beginning). ---

    // --- Video chain (background removal / motion composite, then tail). ---
    if (motionTail) {
      chainParts.push(motionTail);
    } else if (bgResult && bg?.remove) {
      const bgStyle = bg.style ?? "blur";
      chainParts.push(`[0:v]split=2[fg0][bgsrc]`);
      if (bgStyle === "color") {
        chainParts.push(
          `color=c=0x${(bg.color ?? "#111827").replace("#", "")}:s=${probe.width}x${probe.height}:r=${bgResult.fps}:format=rgba[bg0]`
        );
      } else {
        chainParts.push(`[bgsrc]boxblur=luma_radius=${bg.blurAmount ?? 40}:luma_power=2,format=rgba[bg0]`);
      }
      chainParts.push(
        `[1:v]format=gray,scale=${probe.width}:${probe.height}[al0]`,
        `[fg0]format=rgba[fgA0]`,
        `[fgA0][al0]alphamerge[fgm0]`,
        `[bg0][fgm0]overlay=0:0[comp0]`,
        `[comp0]fps=${fps},${videoTail}${tailLabel}`
      );
    } else {
      chainParts.push(`${videoSource}${videoTail}${tailLabel}`);
    }
    if (loopWrap) {
      chainParts.push(
        `[tailv]split[loopv1][loopv2]`,
        `[loopv1][loopv2]xfade=transition=fade:duration=${loopFadeDur.toFixed(3)}:offset=${Math.max(0, durationSec - loopFadeDur).toFixed(3)},trim=0:${durationSec.toFixed(3)},setpts=PTS-STARTPTS[v]`
      );
    }

    // 9. Assemble the ffmpeg command.
    const ffArgs: string[] = ["-hide_banner", "-loglevel", "error", "-y"];
    if (trimStart > 0 && !cuts && !(motion && usePieces)) ffArgs.push("-ss", trimStart.toFixed(3));
    ffArgs.push("-i", sourceFile);
    if (bgResult && subjectUsable) {
      ffArgs.push(
        "-framerate",
        String(bgResult.fps),
        "-start_number",
        "1",
        "-i",
        maskSequencePattern(masksDir!)
      );
    }
    if (musicTrack) {
      ffArgs.push("-stream_loop", "-1", "-i", musicTrack);
    }
    for (let i = 0; i < sfxList.length; i++) {
      ffArgs.push("-i", join(tempDir, "sfx", `sfx${i}.wav`));
    }

    const outFile = join(tempDir, "edited.mp4");
    const { code, stderr } = await runFfmpeg([
      ...ffArgs,
      "-filter_complex",
      chainParts.join(";"),
      "-map",
      "[v]",
      ...audioArgs,
      "-t",
      durationSec.toFixed(2),
      "-c:v",
      "libx264",
      "-preset",
      isPreview ? "fast" : "veryfast",
      "-crf",
      isPreview ? "28" : "23",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-movflags",
      "+faststart",
      outFile,
    ]);
    if (code !== 0) {
      throw new Error(`Video edit failed (code ${code}): ${stderr}\n---FILTER---\n${chainParts.join(";")}`);
    }
    if (!statSync(outFile).size) throw new Error("Video edit produced an empty file.");

    opts.onStage?.("done");
    return {
      filePath: outFile,
      durationMs,
      width: outW,
      height: outH,
      musicTrack: musicTrack ? (musicTrack.replace(/\\/g, "/").split("/").pop() ?? null) : null,
      bgRemoved: Boolean(bgResult && bg?.remove),
    };
  } catch (err) {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    logger.error("video_edit_failed", { workspaceId: opts.workspaceId, error: getErrorMessage(err) });
    throw err;
  } finally {
    if (masksDir) await cleanupMasks(masksDir).catch(() => {});
  }
}

/** Delete the edited file's temp directory after upload. */
export async function cleanupEditedFile(filePath: string): Promise<void> {
  try {
    await fs.rm(join(filePath, ".."), { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

export { listMusicTracks };
export { probeFps };
