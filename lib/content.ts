import { aiConfigured, generateViralContent } from "@/lib/ai";
import { analyzeVideo } from "@/lib/video-analysis";
import { buildCaptionFor, type CaptionBuilderInput } from "@/lib/publishers/types";

export interface GeneratedContent {
  title: string;
  caption: string;
  description: string;
  hashtags: string[];
  aiGenerated: boolean;
}

const cache = new Map<string, GeneratedContent>();

const MAX_CACHE_SIZE = 500;

/** Clear the in-memory generation cache (used by tests). */
export function clearContentCache(): void {
  cache.clear();
}

function cacheKey(input: CaptionBuilderInput): string {
  return `${input.workspace.id}:${input.video.id}`;
}

function normalizeHashtags(tags: string[]): string[] {
  return tags.map((h) => h.replace(/^#/, "").trim()).filter(Boolean);
}

function appendHashtags(caption: string, hashtags: string[]): string {
  const text = hashtags.map((h) => `#${h}`).join(" ");
  return [caption, text].filter(Boolean).join("\n\n");
}

/**
 * Split the trailing "#tag" block off a caption so it can be edited
 * separately in the review UI. Returns the plain text + hashtags.
 */
export function splitHashtagBlock(caption: string): { text: string; hashtags: string[] } {
  const lines = caption.split(/\r?\n/);
  const tags: string[] = [];
  let idx = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length && words.every((w) => w.startsWith("#"))) {
      tags.unshift(...words.map((w) => w.slice(1)));
      idx = i;
    } else {
      break;
    }
  }
  return { text: lines.slice(0, idx).join("\n").trim(), hashtags: tags };
}

async function generateWithAI(input: CaptionBuilderInput, base: GeneratedContent): Promise<GeneratedContent> {
  const { video, workspace } = input;
  const fileName = video.fileName;
  const durationMs = video.durationMs;

  // Vision analysis of the actual video content (frames from Drive).
  // Returns null on failure — content generation still proceeds from filename.
  const analysis = await analyzeVideo(input.workspace.id, video as Parameters<typeof analyzeVideo>[1]);

  const fallback: Awaited<ReturnType<typeof generateViralContent>> = {
    caption: base.caption,
    hashtags: base.hashtags,
    title: base.title,
    description: base.description,
  };
  const result = await generateViralContent({
    fileName,
    durationMs,
    analysis: analysis ?? undefined,
    platform: input.platform,
  }).catch(() => fallback);

  const aiCaption = result.caption.trim() ? result.caption : base.caption;
  const aiHashtags = result.hashtags.length ? normalizeHashtags(result.hashtags) : base.hashtags;
  const aiTitle = result.title.trim() ? result.title : base.title;
  const aiDescription = result.description.trim() ? result.description : base.description;

  // If the provider returned nothing at all, the AI call effectively failed
  // (e.g. no credits, quota exhausted) — report it so the UI can warn the user.
  const aiFailed = !result.caption.trim() && !result.title.trim() && !result.description.trim() && !result.hashtags.length;

  // A custom title is an explicit user choice; never override it.
  const title = workspace.titleMode === "CUSTOM" && workspace.customTitle ? base.title : aiTitle;

  return {
    title,
    caption: appendHashtags(aiCaption, aiHashtags),
    description: aiDescription,
    hashtags: aiHashtags,
    aiGenerated: !aiFailed,
  };
}

/**
 * Build publish content for a video, using AI when enabled and configured.
 * AI failures never break publishing: every field falls back to static content.
 * Generated content is cached per video so all platforms share one generation.
 */
export async function buildContentFor(input: CaptionBuilderInput): Promise<GeneratedContent> {
  const base = buildCaptionFor(input);
  const useAI = Boolean(input.workspace.aiEnabled) && aiConfigured();
  if (!useAI) return { ...base, aiGenerated: false };

  const key = cacheKey(input);
  const cached = cache.get(key);
  if (cached) return cached;

  const generated = await generateWithAI(input, { ...base, aiGenerated: true });
  cache.set(key, generated);
  if (cache.size > MAX_CACHE_SIZE) {
    cache.clear();
  }
  return generated;
}

/**
 * Generate and persist titles for queued videos that don't have one yet.
 * Runs at most `limit` generations per call so API responses stay fast;
 * the remaining videos get titles on subsequent calls.
 * Only stores real AI titles — never the filename fallback.
 */
export async function ensureQueuedVideoTitles(workspaceId: string, limit = 5): Promise<number> {
  const prisma = (await import("@/lib/prisma")).prisma;
  const videos = await prisma.video.findMany({
    where: {
      workspaceId,
      title: null,
      status: { in: ["QUEUED", "SCHEDULED", "VALIDATED"] },
    },
    orderBy: { detectedAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let generated = 0;
  for (const v of videos) {
    const video = await prisma.video.findUnique({
      where: { id: v.id },
      include: { workspace: true },
    });
    if (!video?.workspace) continue;
    const content = await buildContentFor({ video, workspace: video.workspace, platform: "YOUTUBE" });
    if (!content.aiGenerated) continue;
    const title = content.title?.trim();
    if (!title) continue;
    await prisma.video.update({ where: { id: v.id }, data: { title } });
    generated += 1;
  }
  return generated;
}