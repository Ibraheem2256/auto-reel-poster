import { readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { logger } from "@/lib/logger";
import type { VideoType } from "@/lib/ai-edit/types";

/**
 * Licensed asset selection.
 *
 * Music comes from the local `music/` folder (CC0 tracks the operator ships
 * with the app) and is matched to the video's mood/type. External asset
 * search (Freesound) is optional and ONLY queries CC0-licensed results when
 * a FREESOUND_API_KEY is configured — nothing is ever downloaded without a
 * permissive license, and every pick is recorded for auditing.
 */

const MUSIC_DIR = resolve(process.cwd(), "music");

/** Local CC0 track mood tags (keyword match on filename). */
const MOOD_TAGS: Record<string, string[]> = {
  "Funky Energy Loop.mp3": ["action", "viral", "fast", "comedy"],
  "Energizing.mp3": ["motivational", "action", "fast", "viral"],
  "Uberpunch.mp3": ["motivational", "action", "impact", "viral"],
  "Adventure.mp3": ["motivational", "emotional", "cinematic"],
  "Infinite Wonder.mp3": ["emotional", "cinematic", "motivational"],
  "Nomadic Sunset.mp3": ["emotional", "calm", "cinematic"],
  "Meditating Beat.mp3": ["calm", "emotional", "clean"],
  "Be Chillin.mp3": ["calm", "comedy", "clean"],
  "City Sunshine.mp3": ["clean", "tutorial", "calm", "comedy"],
  "Happy Whistling Ukulele.mp3": ["comedy", "clean", "calm"],
};

const TYPE_MOODS: Record<VideoType, string[]> = {
  "talking-head": ["clean", "calm", "tutorial"],
  action: ["action", "fast", "impact"],
  motivational: ["motivational", "impact"],
  emotional: ["emotional", "cinematic", "calm"],
  tutorial: ["clean", "tutorial", "calm"],
  comedy: ["comedy", "clean"],
  generic: ["clean", "calm"],
};

export interface AssetRecord {
  kind: "music" | "sfx" | "ambient";
  source: "local" | "freesound" | "generated";
  name: string;
  license: string;
  url?: string;
}

/** License record for everything used in an AI edit. */
export interface AssetUseReport {
  records: AssetRecord[];
  note: string;
}

export function listLocalTracks(): string[] {
  try {
    return readdirSync(MUSIC_DIR)
      .filter((f) => /\.(mp3|m4a|wav|ogg)$/i.test(f))
      .filter((f) => {
        try {
          return statSync(join(MUSIC_DIR, f)).size > 50_000;
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

/** Pick the best local track for a video type + duration, deterministically. */
export function pickMusicTrack(videoType: VideoType, durationSec: number, seed: string): string | null {
  const tracks = listLocalTracks();
  if (!tracks.length) return null;
  const moods = TYPE_MOODS[videoType] ?? TYPE_MOODS.generic;
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const candidates = tracks.filter((t) => MOOD_TAGS[t]?.some((m) => moods.includes(m)));
  const pool = candidates.length ? candidates : tracks;
  if (durationSec <= 10) {
    // Very short videos: prefer punchy, quick-to-the-point tracks.
    const punchy = pool.filter((t) => MOOD_TAGS[t]?.some((m) => ["action", "impact", "viral", "fast"].includes(m)));
    if (punchy.length) return punchy[Math.abs(hash) % punchy.length];
  }
  return pool[Math.abs(hash) % pool.length];
}

export interface MusicInfo {
  track: string;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
}

/** Volume/fades tuned to content type and length (voice stays on top). */
export function musicMixFor(videoType: VideoType, durationSec: number, hasVoice: boolean): MusicInfo {
  const volume = hasVoice ? 0.18 : 0.3;
  if (durationSec <= 10) {
    return { track: "", volume: Math.min(volume, 0.22), fadeInSec: 0.15, fadeOutSec: 0.5 };
  }
  if (durationSec <= 20) {
    return { track: "", volume, fadeInSec: 0.3, fadeOutSec: 1 };
  }
  return { track: "", volume, fadeInSec: 0.8, fadeOutSec: 1.5 };
}

/**
 * Optional external asset search. Only Freesound with a configured API key
 * is supported, and only CC0 results are returned (safe for commercial use
 * without attribution). Returns [] when not configured — the pipeline falls
 * back to synthesized SFX + local CC0 music, which is always safe.
 */
export async function searchExternalAssets(opts: {
  query: string;
  kind: "sfx" | "music" | "ambient";
  max?: number;
}): Promise<AssetRecord[]> {
  const key = process.env.FREESOUND_API_KEY;
  if (!key) return [];
  try {
    const kindFilter = opts.kind === "sfx" ? "duration:[0 TO 3]" : opts.kind === "music" ? "duration:[3 TO 60]" : "duration:[5 TO 120]";
    const res = await fetch(
      `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(opts.query)}&filter=${encodeURIComponent(
        `license:CC0 ${kindFilter}`
      )}&fields=id,name,url,license,previews&page_size=${opts.max ?? 5}`,
      { headers: { Authorization: `Token ${key}` } }
    );
    if (!res.ok) {
      logger.warn("freesound_search_failed", { status: res.status });
      return [];
    }
    const data = (await res.json()) as { results?: { id: number; name: string; url: string; license: string }[] };
    return (data.results ?? []).map((r) => ({
      kind: opts.kind,
      source: "freesound",
      name: r.name,
      license: r.license,
      url: r.url,
    }));
  } catch (err) {
    logger.warn("freesound_search_error", { error: String(err) });
    return [];
  }
}

export function makeAssetReport(records: AssetRecord[]): AssetUseReport {
  return {
    records,
    note:
      "Music: local CC0 tracks. SFX: locally synthesized (no third-party material). " +
      "External assets are only ever fetched from CC0-licensed sources. Nothing copyrighted is used.",
  };
}