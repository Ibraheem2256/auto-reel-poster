import type { TextOverlay, TextAnimation } from "@/lib/editor-spec";
import type { VideoType } from "@/lib/ai-edit/types";
import { generateCaptionLines, type CaptionLine } from "@/lib/ai";

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "so", "of", "to", "in", "on", "at",
  "for", "with", "is", "are", "was", "were", "it", "its", "this", "that",
  "you", "your", "we", "our", "i", "my", "me", "do", "does", "did", "not",
]);

/** Split into words worth emphasizing (long, non-stop words). */
function pickEmphasis(line: string, max = 2): string[] {
  const words = line
    .replace(/[^a-zA-Z0-9\s'-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w.toLowerCase()));
  words.sort((a, b) => b.length - a.length);
  return words.slice(0, max).map((w) => w.toUpperCase());
}

/** Fallback lines when AI is not configured: hook/title broken into chunks. */
function fallbackLines(hookText: string, topic: string): CaptionLine[] {
  const src = (hookText || topic || "").trim().replace(/\s+/g, " ");
  if (!src) {
    return [{ text: "WATCH THIS", emphasis: ["WATCH"] }];
  }
  const words = src.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= 26 || !cur) {
      cur = next;
    } else {
      lines.push(cur);
      cur = w;
    }
    if (lines.length >= 3) break;
  }
  if (cur) lines.push(cur);
  const clean = lines.map((l) => l.slice(0, 44)).filter(Boolean).slice(0, 4);
  if (!clean.length) return [{ text: "WATCH THIS", emphasis: ["WATCH"] }];
  return clean.map((text) => ({ text, emphasis: pickEmphasis(text) }));
}

/**
 * Generate on-screen caption lines for the video. Uses the AI when it is
 * configured, otherwise falls back to the hook/topic broken into readable
 * lines with heuristic emphasis.
 */
export async function buildCaptionLines(opts: {
  fileName: string;
  hookText: string;
  aiAnalysis?: { topic: string; style: string } | null;
  videoType: VideoType;
}): Promise<CaptionLine[]> {
  const aiLines = await generateCaptionLines({
    fileName: opts.fileName,
    hookText: opts.hookText,
    topic: opts.aiAnalysis?.topic,
    style: opts.aiAnalysis?.style,
    videoType: opts.videoType,
  });
  if (aiLines.length >= 2) return aiLines;
  return fallbackLines(opts.hookText, opts.aiAnalysis?.topic ?? "");
}

export interface CaptionPlacement {
  lines: CaptionLine[];
  /** Speech windows in FINAL timeline seconds. */
  speech: { start: number; end: number }[];
  durationSec: number;
  /** Vertical anchor (% of height) for the first line. */
  startY?: number;
}

/**
 * Place caption lines on the final timeline: each line lands inside a speech
 * window (or spread evenly when there is none), staggered vertically so
 * captions never cover the face. Returns TextOverlays ready for the spec.
 */
export function placeCaptions(opts: CaptionPlacement): TextOverlay[] {
  const { lines, speech, durationSec } = opts;
  if (!lines.length || durationSec <= 0) return [];

  const windows = speech.length
    ? speech
    : [{ start: 0.6, end: durationSec - 0.4 }];
  const usable = windows.filter((w) => w.end - w.start >= 0.6);
  if (!usable.length) return [];

  const startY = opts.startY ?? 68;
  const lineGap = 11;
  const minOn = 1.2;
  const out: TextOverlay[] = [];

  // Distribute lines across the windows (first line = the hook, earliest).
  const perWindow = Math.max(1, Math.ceil(lines.length / Math.min(usable.length, 4)));
  let lineIdx = 0;
  for (const w of usable) {
    if (lineIdx >= lines.length) break;
    for (let i = 0; i < perWindow && lineIdx < lines.length; i++) {
      const line = lines[lineIdx];
      const span = Math.max(minOn, w.end - w.start);
      const offset = i * (span / Math.max(1, perWindow + 1)) + span * 0.12;
      const start = Math.min(w.start + offset, Math.max(0, durationSec - minOn));
      const end = Math.min(w.end + 0.15, durationSec);
      const anim: TextAnimation = lineIdx === 0 ? "pop" : i === 0 ? "slide-up" : "fade-in";
      out.push({
        id: `cap-${lineIdx}`,
        text: line.text,
        fontSize: lineIdx === 0 ? 62 : 56,
        color: "#ffffff",
        strokeColor: "#000000",
        y: Math.min(88, startY + lineIdx * lineGap),
        animation: anim,
        startSec: Math.max(0, start),
        endSec: Math.max(start + minOn, Math.min(end, durationSec)),
        emphasis: line.emphasis.length ? line.emphasis : pickEmphasis(line.text, 1),
      });
      lineIdx += 1;
    }
  }
  return out;
}

export { pickEmphasis };