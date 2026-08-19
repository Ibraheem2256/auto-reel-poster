import { prisma } from "@/lib/prisma";
import type { Platform } from "@prisma/client";
import { BEST_TIME_WINDOWS, BEST_TIME_LABELS, PLATFORM_LABELS } from "@/lib/constants";

export interface TimeSlot {
  hour: number;
  label: string;
  avgViews: number;
  avgEngagement: number;
  postCount: number;
  score: number; // 0-100
  isPeak: boolean;
}

export interface PlatformTiming {
  platform: Platform;
  bestSlots: TimeSlot[];
  worstSlots: TimeSlot[];
  currentScheduleFit: number; // 0-100 — how well current schedule matches peak
  recommendation: string;
  peakWindows: { start: number; end: number; label: string }[];
}

export interface TimingReport {
  platforms: PlatformTiming[];
  overallBestTime: string;
  scheduleSuggestions: { platform: Platform; times: string[] }[];
  generatedAt: Date;
}

function hourToLabel(hour: number): string {
  if (hour === 0 || hour === 24) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

function calcScore(
  views: number,
  engagement: number,
  postCount: number,
  maxViews: number,
  maxEngagement: number
): number {
  if (maxViews === 0 && maxEngagement === 0) return 50;
  const viewScore = maxViews > 0 ? (views / maxViews) * 60 : 0;
  const engScore = maxEngagement > 0 ? (engagement / maxEngagement) * 40 : 0;
  const volumeBonus = Math.min(20, postCount * 5);
  return Math.min(100, Math.round(viewScore + engScore + volumeBonus));
}

/**
 * Returns the best posting hours for a platform based on actual performance data.
 * Falls back to static BEST_TIME_WINDOWS if not enough data (< 5 posts).
 * Returns hours sorted by score descending.
 */
export async function getBestHoursForPlatform(
  workspaceId: string,
  platform: Platform,
  count: number = 4
): Promise<number[]> {
  const MIN_POSTS_FOR_DATA = 5;

  const [metrics, posts] = await Promise.all([
    prisma.performanceMetric.findMany({
      where: { workspaceId, platform },
    }),
    prisma.platformJob.findMany({
      where: { workspaceId, platform, status: "SUCCESS", publishedAt: { not: null } },
      select: { publishedAt: true, videoId: true },
    }),
  ]);

  // Not enough data — fall back to static windows
  if (posts.length < MIN_POSTS_FOR_DATA) {
    const windows = BEST_TIME_WINDOWS[platform] ?? [];
    const hours: number[] = [];
    for (const w of windows) {
      for (let h = w.start; h < w.end; h++) hours.push(h);
    }
    return hours.slice(0, count);
  }

  // Build hourly stats from actual data
  const hourlyStats: Record<number, { views: number; engagement: number; count: number }> = {};
  for (let h = 0; h < 24; h++) {
    hourlyStats[h] = { views: 0, engagement: 0, count: 0 };
  }

  for (const post of posts) {
    if (!post.publishedAt) continue;
    const hour = post.publishedAt.getHours();
    const metric = metrics.find((m) => m.videoId === post.videoId);
    if (metric) {
      hourlyStats[hour].views += metric.views;
      hourlyStats[hour].engagement += metric.likes + metric.comments + metric.shares;
    }
    hourlyStats[hour].count++;
  }

  // Score each hour
  let maxAvgViews = 0;
  let maxAvgEngagement = 0;
  for (let h = 0; h < 24; h++) {
    const stat = hourlyStats[h];
    const avgViews = stat.count > 0 ? stat.views / stat.count : 0;
    const avgEngagement = stat.count > 0 ? stat.engagement / stat.count : 0;
    maxAvgViews = Math.max(maxAvgViews, avgViews);
    maxAvgEngagement = Math.max(maxAvgEngagement, avgEngagement);
  }

  const scored: { hour: number; score: number }[] = [];
  for (let h = 0; h < 24; h++) {
    const stat = hourlyStats[h];
    const avgViews = stat.count > 0 ? stat.views / stat.count : 0;
    const avgEngagement = stat.count > 0 ? stat.engagement / stat.count : 0;
    scored.push({
      hour: h,
      score: calcScore(avgViews, avgEngagement, stat.count, maxAvgViews, maxAvgEngagement),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map((s) => s.hour);
}

export async function analyzeTiming(workspaceId: string): Promise<TimingReport> {
  const [metrics, posts, schedules] = await Promise.all([
    prisma.performanceMetric.findMany({
      where: { workspaceId },
      orderBy: { fetchedAt: "desc" },
    }),
    prisma.platformJob.findMany({
      where: { workspaceId, status: "SUCCESS", publishedAt: { not: null } },
      select: { platform: true, publishedAt: true, videoId: true },
    }),
    prisma.schedule.findMany({
      where: { workspaceId, enabled: true },
    }),
  ]);

  const platforms: Platform[] = ["TIKTOK", "YOUTUBE", "INSTAGRAM", "FACEBOOK"];
  const platformTimings: PlatformTiming[] = [];

  for (const platform of platforms) {
    const platformPosts = posts.filter((p) => p.platform === platform);
    const platformMetrics = metrics.filter((m) => m.platform === platform);

    // Build hourly stats
    const hourlyStats: Record<number, { views: number; engagement: number; count: number }> = {};
    for (let h = 0; h < 24; h++) {
      hourlyStats[h] = { views: 0, engagement: 0, count: 0 };
    }

    for (const post of platformPosts) {
      if (!post.publishedAt) continue;
      const hour = post.publishedAt.getHours();
      const metric = platformMetrics.find((m) => m.videoId === post.videoId);
      if (metric) {
        hourlyStats[hour].views += metric.views;
        hourlyStats[hour].engagement += metric.likes + metric.comments + metric.shares;
      }
      hourlyStats[hour].count++;
    }

    // Calculate averages and scores
    const slots: TimeSlot[] = [];
    let maxAvgViews = 0;
    let maxAvgEngagement = 0;

    for (let h = 0; h < 24; h++) {
      const stat = hourlyStats[h];
      const avgViews = stat.count > 0 ? stat.views / stat.count : 0;
      const avgEngagement = stat.count > 0 ? stat.engagement / stat.count : 0;
      maxAvgViews = Math.max(maxAvgViews, avgViews);
      maxAvgEngagement = Math.max(maxAvgEngagement, avgEngagement);
    }

    for (let h = 0; h < 24; h++) {
      const stat = hourlyStats[h];
      const avgViews = stat.count > 0 ? stat.views / stat.count : 0;
      const avgEngagement = stat.count > 0 ? stat.engagement / stat.count : 0;
      const peakWindows = BEST_TIME_WINDOWS[platform];
      const isPeak = peakWindows.some((w) => h >= w.start && h < w.end);

      slots.push({
        hour: h,
        label: hourToLabel(h),
        avgViews: Math.round(avgViews),
        avgEngagement: Math.round(avgEngagement * 100) / 100,
        postCount: stat.count,
        score: calcScore(avgViews, avgEngagement, stat.count, maxAvgViews, maxAvgEngagement),
        isPeak,
      });
    }

    const sorted = [...slots].sort((a, b) => b.score - a.score);
    const bestSlots = sorted.slice(0, 5);
    const worstSlots = sorted.slice(-5).reverse();

    // Check how well current schedule matches peaks
    const peakHours = BEST_TIME_WINDOWS[platform].flatMap((w) => {
      const hours: number[] = [];
      for (let h = w.start; h < w.end; h++) hours.push(h);
      return hours;
    });
    const postsInPeak = platformPosts.filter((p) => {
      if (!p.publishedAt) return false;
      return peakHours.includes(p.publishedAt.getHours());
    }).length;
    const currentScheduleFit = platformPosts.length > 0
      ? Math.round((postsInPeak / platformPosts.length) * 100)
      : 50;

    const peakWindows = BEST_TIME_WINDOWS[platform].map((w) => ({
      start: w.start,
      end: w.end,
      label: BEST_TIME_LABELS[platform],
    }));

    let recommendation = "";
    if (platformPosts.length < 5) {
      recommendation = `Abhi sirf ${platformPosts.length} posts hain. 10+ posts ke baad accurate analysis milega. Abhi industry standard: ${BEST_TIME_LABELS[platform]}`;
    } else if (currentScheduleFit < 50) {
      const topTime = bestSlots[0];
      recommendation = `Aapke data se ${topTime.label} pe best performance hai. Schedule ko ${topTime.label} pe shift karo.`;
    } else {
      recommendation = `Achha! Aapke ${currentScheduleFit}% posts peak hours pe hain. Continue karo!`;
    }

    platformTimings.push({
      platform,
      bestSlots,
      worstSlots,
      currentScheduleFit,
      recommendation,
      peakWindows,
    });
  }

  // Overall best time (most common top slot across platforms)
  const hourCounts: Record<number, number> = {};
  for (const pt of platformTimings) {
    for (const slot of pt.bestSlots.slice(0, 3)) {
      hourCounts[slot.hour] = (hourCounts[slot.hour] || 0) + 1;
    }
  }
  const bestHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const overallBestTime = bestHour ? hourToLabel(Number(bestHour)) : "12 PM - 3 PM";

  // Schedule suggestions
  const scheduleSuggestions = platformTimings.map((pt) => ({
    platform: pt.platform,
    times: pt.bestSlots.slice(0, 3).map((s) => `${s.label} (${s.avgViews} avg views)`),
  }));

  return {
    platforms: platformTimings,
    overallBestTime,
    scheduleSuggestions,
    generatedAt: new Date(),
  };
}
