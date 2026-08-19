import { prisma } from "@/lib/prisma";
import type { Platform } from "@prisma/client";
import type { EditSpec } from "@/lib/editor-spec";
import type { AiEditAction, AiEditIntensity } from "@/lib/ai-edit/types";
import { BEST_TIME_WINDOWS, PLATFORM_LABELS } from "@/lib/constants";

const AI_DELAY_MS = 1500;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface EnhancementSuggestion {
  id: string;
  category: "hook" | "captions" | "color" | "audio" | "pacing" | "timing" | "content" | "music";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  autoFixable: boolean;
  action: AiEditAction;
  estimatedImpact: string;
}

export interface VideoEnhancement {
  videoId: string;
  fileName: string;
  currentScore: number;
  suggestions: EnhancementSuggestion[];
  autoEnhancedSpec: EditSpec | null;
  viralContent: {
    caption: string;
    hashtags: string[];
    title: string;
    description: string;
  } | null;
  bestTimeToPost: { platform: Platform; time: string }[];
}

export interface EnhancementReport {
  totalVideos: number;
  videosNeedingEnhancement: number;
  avgScore: number;
  enhancements: VideoEnhancement[];
  bulkActions: { label: string; description: string; action: string }[];
  generatedAt: Date;
}

function generateEnhancementSuggestions(
  video: { editSpec: unknown; durationMs: number | null; fileName: string; width: number | null; height: number | null },
  metrics: { views: number; likes: number; comments: number; shares: number }[],
  platform: Platform
): EnhancementSuggestion[] {
  const suggestions: EnhancementSuggestion[] = [];
  const totalViews = metrics.reduce((s, m) => s + m.views, 0);
  const totalLikes = metrics.reduce((s, m) => s + m.likes, 0);
  const totalComments = metrics.reduce((s, m) => s + m.comments, 0);
  const engagementRate = totalViews > 0 ? ((totalLikes + totalComments) / totalViews) * 100 : 0;

  // Hook suggestions
  if (engagementRate < 3 || totalViews < 100) {
    suggestions.push({
      id: "hook-strengthen",
      category: "hook",
      priority: "high",
      title: "Hook ko做强 karo",
      description: "Pehle 2 seconds bahut weak lag rahe hain. Strong hook text add karo ya opening scene change karo.",
      autoFixable: true,
      action: "improve-hook",
      estimatedImpact: "Retention 20-40% badhega, views 2-3x ho sakte hain.",
    });
  }

  // Caption suggestions
  const spec = video.editSpec as EditSpec | null;
  if (!spec?.texts || spec.texts.length === 0) {
    suggestions.push({
      id: "captions-add",
      category: "captions",
      priority: "high",
      title: "Captions add karo",
      description: "85% log bina sound dekhte hain. Captions se watch time badhta hai.",
      autoFixable: true,
      action: "improve-captions",
      estimatedImpact: "Watch time 30-50% badhega. Algorithm ko watch time pasand hai.",
    });
  }

  // Color/visual suggestions
  if (!spec?.filter || spec.filter === "none") {
    suggestions.push({
      id: "color-grade",
      category: "color",
      priority: "medium",
      title: "Color grading lagao",
      description: "Raw footage dull lag raha hai. Cinematic ya vivid filter se video attractive lagegi.",
      autoFixable: true,
      action: "improve-color",
      estimatedImpact: "Visual appeal badhega, thumbnail click-through rate 10-20% badhega.",
    });
  }

  // Audio suggestions
  if (!spec?.audio?.noiseReduction) {
    suggestions.push({
      id: "audio-enhance",
      category: "audio",
      priority: "medium",
      title: "Audio enhance karo",
      description: "Noise reduction aur loudness normalization se audio professional lagega.",
      autoFixable: true,
      action: "improve-audio",
      estimatedImpact: "Audio quality se viewer retention badhta hai.",
    });
  }

  // Music suggestion
  if (!spec?.music) {
    suggestions.push({
      id: "music-add",
      category: "music",
      priority: "low",
      title: "Background music add karo",
      description: "CC0 music se mood set hota hai. Trending sound se viral chances badhte hain.",
      autoFixable: true,
      action: "auto",
      estimatedImpact: "Emotional connection badhega, shares 10-20% badh sakte hain.",
    });
  }

  // Pacing suggestions
  const durationSec = (video.durationMs ?? 0) / 1000;
  if (durationSec > 45) {
    suggestions.push({
      id: "pacing-speed",
      category: "pacing",
      priority: "medium",
      title: "Video ko fast karo",
      description: `${Math.round(durationSec)}s lambi hai. Short-form mein 15-30s ideal hai. Dead space hatao.`,
      autoFixable: true,
      action: "fast",
      estimatedImpact: "Retention rate 20-30% badhega. Watch-through rate improve hoga.",
    });
  }

  // Timing suggestions
  const peakWindows = BEST_TIME_WINDOWS[platform];
  suggestions.push({
    id: "timing-optimize",
    category: "timing",
    priority: "high",
    title: `${PLATFORM_LABELS[platform]} pe best time pe post karo`,
    description: `Peak hours: ${peakWindows.map((w) => `${w.start}:00-${w.end}:00`).join(", ")}. Abhi galat time pe ho raha hai.`,
    autoFixable: false,
    action: "auto",
    estimatedImpact: "Timing optimization se 30-50% views badh sakte hain.",
  });

  // Content suggestions
  if (totalViews > 0 && engagementRate < 2) {
    suggestions.push({
      id: "content-cta",
      category: "content",
      priority: "high",
      title: "CTA (Call to Action) add karo",
      description: "End mein 'Follow for more' ya 'Comment karo' bolo. Engagement badhega.",
      autoFixable: false,
      action: "auto",
      estimatedImpact: "Comments aur follows 2-5x badh sakte hain.",
    });
  }

  return suggestions.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });
}

function calculateScore(
  video: { editSpec: unknown; durationMs: number | null },
  metrics: { views: number; likes: number; comments: number }[]
): number {
  let score = 50; // baseline
  const spec = video.editSpec as EditSpec | null;

  if (spec) score += 10;
  if (spec?.texts && spec.texts.length > 0) score += 10;
  if (spec?.filter && spec.filter !== "none") score += 5;
  if (spec?.audio) score += 5;
  if (spec?.music) score += 5;

  const totalViews = metrics.reduce((s, m) => s + m.views, 0);
  const totalLikes = metrics.reduce((s, m) => s + m.likes, 0);
  const engagementRate = totalViews > 0 ? (totalLikes / totalViews) * 100 : 0;
  if (engagementRate > 5) score += 15;
  else if (engagementRate > 3) score += 10;
  else if (engagementRate > 1) score += 5;

  const durationSec = (video.durationMs ?? 0) / 1000;
  if (durationSec >= 10 && durationSec <= 30) score += 5;

  return Math.min(100, score);
}

export async function generateEnhancements(workspaceId: string): Promise<EnhancementReport> {
  const videos = await prisma.video.findMany({
    where: { workspaceId, status: { in: ["VALIDATED", "QUEUED", "SCHEDULED", "PUBLISHED"] } },
    include: {
      platformJobs: { select: { platform: true, status: true } },
      performanceMetrics: { select: { views: true, likes: true, comments: true, shares: true, platform: true } },
    },
    orderBy: { detectedAt: "desc" },
    take: 20,
  });

  const enhancements: VideoEnhancement[] = [];
  let totalScore = 0;

  for (const video of videos) {
    const metrics = video.performanceMetrics;
    const score = calculateScore(video, metrics);
    totalScore += score;

    const primaryPlatform = video.platformJobs[0]?.platform ?? "TIKTOK";
    const suggestions = generateEnhancementSuggestions(
      {
        editSpec: video.editSpec,
        durationMs: video.durationMs,
        fileName: video.fileName,
        width: video.width,
        height: video.height,
      },
      metrics,
      primaryPlatform
    );

    // Use cached AI content from content.ts if available — no extra API calls
    let viralContent: VideoEnhancement["viralContent"] = null;

    // Best time to post per platform
    const bestTimeToPost = (video.platformJobs.length > 0
      ? [...new Set(video.platformJobs.map((j) => j.platform))]
      : ["TIKTOK", "YOUTUBE", "INSTAGRAM", "FACEBOOK"] as Platform[]
    ).map((platform) => ({
      platform,
      time: BEST_TIME_WINDOWS[platform]
        .map((w) => `${w.start}:00-${w.end}:00`)
        .join(", "),
    }));

    enhancements.push({
      videoId: video.id,
      fileName: video.fileName,
      currentScore: score,
      suggestions,
      autoEnhancedSpec: null,
      viralContent,
      bestTimeToPost,
    });
  }

  const videosNeedingEnhancement = enhancements.filter((e) => e.suggestions.length > 0).length;

  return {
    totalVideos: videos.length,
    videosNeedingEnhancement,
    avgScore: videos.length > 0 ? Math.round(totalScore / videos.length) : 0,
    enhancements,
    bulkActions: [
      {
        label: "Sabko Auto-Edit karo",
        description: "Saari videos ko AI Edit se enhance karo (captions + color + audio + effects).",
        action: "auto-edit-all",
      },
      {
        label: "Sabmein Captions add karo",
        description: "Saari videos mein automatic captions generate karo.",
        action: "captions-all",
      },
      {
        label: "Timing optimize karo",
        description: "Saari schedules ko best time pe shift karo.",
        action: "optimize-timing-all",
      },
    ],
    generatedAt: new Date(),
  };
}
