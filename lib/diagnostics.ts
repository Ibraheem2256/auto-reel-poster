import { prisma } from "@/lib/prisma";
import type { Platform } from "@prisma/client";
import { BEST_TIME_WINDOWS, PLATFORM_LABELS } from "@/lib/constants";

export interface DiagnosticIssue {
  severity: "critical" | "warning" | "info";
  category: "timing" | "content" | "quality" | "frequency" | "platform" | "engagement";
  title: string;
  description: string;
  fix: string;
  impact: string;
}

export interface PlatformDiagnostic {
  platform: Platform;
  totalPosted: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  avgViews: number;
  avgEngagementRate: number;
  issues: DiagnosticIssue[];
  score: number; // 0-100 health score
}

export interface DiagnosticReport {
  overallScore: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  avgEngagementRate: number;
  platforms: PlatformDiagnostic[];
  topIssues: DiagnosticIssue[];
  recommendations: string[];
  generatedAt: Date;
}

function calcEngagementRate(views: number, likes: number, comments: number, shares: number): number {
  if (views === 0) return 0;
  return ((likes + comments + shares) / views) * 100;
}

function checkTimingIssues(posts: { publishedAt: Date | null }[], platform: Platform): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];
  const windows = BEST_TIME_WINDOWS[platform];
  if (!windows || posts.length === 0) return issues;

  let outsideCount = 0;
  for (const post of posts) {
    if (!post.publishedAt) continue;
    const hour = post.publishedAt.getHours(); // UTC hour — approximate
    const inWindow = windows.some((w) => hour >= w.start && hour < w.end);
    if (!inWindow) outsideCount++;
  }

  const outsideRate = outsideCount / posts.length;
  if (outsideRate > 0.6) {
    issues.push({
      severity: "critical",
      category: "timing",
      title: "Galat time pe post ho raha hai",
      description: `${Math.round(outsideRate * 100)}% posts peak hours ke bahar ja rahe hain. ${PLATFORM_LABELS[platform]} ke best hours: ${windows.map((w) => `${w.start}:00-${w.end}:00`).join(", ")}`,
      fix: "Schedule ko 'Best Times' mode pe set karo ya manually peak hours select karo.",
      impact: "Timing fix se 30-50% views badh sakte hain.",
    });
  } else if (outsideRate > 0.3) {
    issues.push({
      severity: "warning",
      category: "timing",
      title: "Kuch posts off-peak ja rahe hain",
      description: `${Math.round(outsideRate * 100)}% posts optimal time ke bahar hain.`,
      fix: "Zyada posts peak hours mein schedule karo.",
      impact: "Thoda aur views aa sakta hai.",
    });
  }
  return issues;
}

function checkFrequencyIssues(postCount: number, daysSinceFirst: number): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];
  if (daysSinceFirst < 1) return issues;
  const postsPerDay = postCount / Math.max(1, daysSinceFirst);

  if (postsPerDay < 0.5) {
    issues.push({
      severity: "critical",
      category: "frequency",
      title: "Bahut kam post ho rahe hain",
      description: `Sirf ${postsPerDay.toFixed(1)} posts/day. Minimum 1-2 posts daily chahiye growth ke liye.`,
      fix: "Google Drive mein zyada videos dalo ya automation on karo. Daily 2-3 posts ka target rakho.",
      impact: "Consistent posting se algorithm boost milta hai. 2-3x views badh sakte hain.",
    });
  } else if (postsPerDay < 1) {
    issues.push({
      severity: "warning",
      category: "frequency",
      title: "Posting frequency kam hai",
      description: `${postsPerDay.toFixed(1)} posts/day. Daily 1-2 posts better hain.`,
      fix: "Drive folder mein aur videos add karo.",
      impact: "Zyada posts = zyada chances for viral content.",
    });
  }
  return issues;
}

function checkEngagementIssues(
  views: number,
  likes: number,
  comments: number,
  shares: number,
  platform: Platform
): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];
  const rate = calcEngagementRate(views, likes, comments, shares);

  if (views > 0 && rate < 1) {
    issues.push({
      severity: "critical",
      category: "engagement",
      title: "Engagement rate bahut kam hai",
      description: `${rate.toFixed(1)}% engagement rate. Good rate: 3-8%. Content audience ko attract nahi kar raha.`,
      fix: "Hook (pehle 2 sec) strong banao, captions add karo, trending topics pe banao. CTA do (like, comment, share).",
      impact: "High engagement se algorithm push karta hai, views 5-10x badh sakte hain.",
    });
  } else if (views > 0 && rate < 3) {
    issues.push({
      severity: "warning",
      category: "engagement",
      title: "Engagement average hai",
      description: `${rate.toFixed(1)}% engagement rate. Better ho sakta hai.`,
      fix: "End mein question pucho ya controversial opinion do to boost comments.",
      impact: "Comments badhenge to algorithm promote karega.",
    });
  }

  if (shares === 0 && views > 100) {
    issues.push({
      severity: "critical",
      category: "engagement",
      title: "Koi share nahi ho raha",
      description: "Shares se viral hota hai content. 0 shares = content shareable nahi hai.",
      fix: "Relatable, funny, ya inspiring content banao. Emotional trigger use karo.",
      impact: "Shares sabse powerful signal hain. 1 share = 10-50 organic views.",
    });
  }
  return issues;
}

function checkContentIssues(
  hasEditSpec: boolean,
  editScore: number | null,
  postCount: number
): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];

  if (!hasEditSpec && postCount > 0) {
    issues.push({
      severity: "warning",
      category: "quality",
      title: "Video editing optimize nahi hai",
      description: "Raw video publish ho raha hai bina editing ke. Captions, effects, aur transitions missing hain.",
      fix: "AI Edit use karo ya manual EditSpec banao. Captions + hook text + color grade add karo.",
      impact: "Edited videos 2-3x zyada retention dete hain.",
    });
  }

  if (editScore !== null && editScore < 50) {
    issues.push({
      severity: "warning",
      category: "quality",
      title: "Video quality score kam hai",
      description: `Edit score ${editScore}/100 hai. Hook, pacing, ya audio improve kar sakte ho.`,
      fix: "AI Edit se re-edit karo ya specific improvements karo (audio, color, captions).",
      impact: "Better quality = better retention = more views.",
    });
  }

  if (postCount > 0 && !hasEditSpec) {
    issues.push({
      severity: "info",
      category: "content",
      title: "Auto-Edit enable karo",
      description: "Workspace settings mein auto-edit on karo taaki har video automatically optimize ho.",
      fix: "Settings > Auto-Edit toggle on karo.",
      impact: "Har video automatically 9:16 crop + captions + effects milega.",
    });
  }
  return issues;
}

function checkPlatformIssues(
  platform: Platform,
  totalPosted: number,
  totalViews: number
): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];
  if (totalPosted === 0) return issues;

  const avgViews = totalViews / totalPosted;

  if (platform === "TIKTOK" && avgViews < 100) {
    issues.push({
      severity: "warning",
      category: "platform",
      title: "TikTok pe views kam hain",
      description: `Average ${Math.round(avgViews)} views per video. TikTok pe trending sounds aur challenges use karo.`,
      fix: "Trending hashtags, sounds, aur challenges follow karo. Duet/Stitch feature use karo.",
      impact: "TikTok ka algorithm naye accounts ko boost deta hai pehle 7 days.",
    });
  }

  if (platform === "YOUTUBE" && avgViews < 50) {
    issues.push({
      severity: "warning",
      category: "platform",
      title: "YouTube Shorts pe views kam hain",
      description: `Average ${Math.round(avgViews)} views. YouTube ke liye SEO aur thumbnails important hain.`,
      fix: "Title mein keywords rakho, description optimize karo, #Shorts lagao.",
      impact: "YouTube search se long-term views aate hain.",
    });
  }

  if (platform === "INSTAGRAM" && avgViews < 50) {
    issues.push({
      severity: "warning",
      category: "platform",
      title: "Instagram Reels pe views kam hain",
      description: `Average ${Math.round(avgViews)} views. Instagram pe visual quality aur trending audio important hai.`,
      fix: "Instagram trending audio use karo, location tag karo, Stories pe share karo.",
      impact: "Instagram Explore page pe aane se views 10x badh sakte hain.",
    });
  }

  return issues;
}

export async function runDiagnostics(workspaceId: string): Promise<DiagnosticReport> {
  const [posts, videos, metrics, schedules] = await Promise.all([
    prisma.platformJob.findMany({
      where: { workspaceId, status: "SUCCESS" },
      include: { video: { select: { editSpec: true, fileName: true } } },
      orderBy: { publishedAt: "desc" },
    }),
    prisma.video.findMany({
      where: { workspaceId },
      select: { id: true, editSpec: true, status: true, detectedAt: true },
    }),
    prisma.performanceMetric.findMany({
      where: { workspaceId },
      orderBy: { fetchedAt: "desc" },
    }),
    prisma.schedule.findMany({
      where: { workspaceId, enabled: true },
    }),
  ]);

  const totalPosted = posts.length;
  const firstPost = posts.length > 0 ? posts[posts.length - 1].publishedAt : null;
  const daysSinceFirst = firstPost
    ? Math.max(1, (Date.now() - firstPost.getTime()) / (1000 * 60 * 60 * 24))
    : 1;

  const allIssues: DiagnosticIssue[] = [];

  allIssues.push(...checkFrequencyIssues(totalPosted, daysSinceFirst));
  allIssues.push(...checkContentIssues(
    videos.some((v) => v.editSpec !== null),
    null,
    totalPosted
  ));

  const platformDiagnostics: PlatformDiagnostic[] = [];
  const platforms: Platform[] = ["TIKTOK", "YOUTUBE", "INSTAGRAM", "FACEBOOK"];

  for (const platform of platforms) {
    const platformPosts = posts.filter((p) => p.platform === platform);
    const platformMetrics = metrics.filter((m) => m.platform === platform);

    const totalViews = platformMetrics.reduce((s, m) => s + m.views, 0);
    const totalLikes = platformMetrics.reduce((s, m) => s + m.likes, 0);
    const totalComments = platformMetrics.reduce((s, m) => s + m.comments, 0);
    const totalShares = platformMetrics.reduce((s, m) => s + m.shares, 0);
    const avgViews = platformPosts.length > 0 ? Math.round(totalViews / platformPosts.length) : 0;
    const avgEngagement = calcEngagementRate(totalViews, totalLikes, totalComments, totalShares);

    const issues: DiagnosticIssue[] = [
      ...checkTimingIssues(platformPosts, platform),
      ...checkEngagementIssues(totalViews, totalLikes, totalComments, totalShares, platform),
      ...checkPlatformIssues(platform, platformPosts.length, totalViews),
    ];

    const score = Math.max(0, Math.min(100,
      100
      - issues.filter((i) => i.severity === "critical").length * 25
      - issues.filter((i) => i.severity === "warning").length * 10
      - issues.filter((i) => i.severity === "info").length * 3
    ));

    allIssues.push(...issues);
    platformDiagnostics.push({
      platform,
      totalPosted: platformPosts.length,
      totalViews,
      totalLikes,
      totalComments,
      totalShares,
      avgViews,
      avgEngagementRate: Math.round(avgEngagement * 100) / 100,
      issues,
      score,
    });
  }

  const totalViews = metrics.reduce((s, m) => s + m.views, 0);
  const totalLikes = metrics.reduce((s, m) => s + m.likes, 0);
  const totalComments = metrics.reduce((s, m) => s + m.comments, 0);
  const totalShares = metrics.reduce((s, m) => s + m.shares, 0);
  const avgEngagement = calcEngagementRate(totalViews, totalLikes, totalComments, totalShares);

  const overallScore = Math.round(
    platformDiagnostics.reduce((s, p) => s + p.score, 0) / Math.max(1, platformDiagnostics.length)
  );

  const topIssues = allIssues
    .sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    })
    .slice(0, 8);

  const recommendations = generateRecommendations(topIssues, totalPosted, avgEngagement);

  return {
    overallScore,
    totalViews,
    totalLikes,
    totalComments,
    totalShares,
    avgEngagementRate: Math.round(avgEngagement * 100) / 100,
    platforms: platformDiagnostics,
    topIssues,
    recommendations,
    generatedAt: new Date(),
  };
}

function generateRecommendations(
  issues: DiagnosticIssue[],
  totalPosted: number,
  engagementRate: number
): string[] {
  const recs: string[] = [];

  if (totalPosted === 0) {
    recs.push("Pehle 10-20 videos publish karo taaki data collect ho. Abhi sirf uploading pe focus karo.");
  }

  if (engagementRate < 3) {
    recs.push("Pehle 2 seconds mein hook do — 'Wait for this!' ya unexpected visual. Retention badhega.");
  }

  const hasTimingIssue = issues.some((i) => i.category === "timing");
  if (hasTimingIssue) {
    recs.push("Schedule > 'Best Times' mode enable karo. Platform-specific peak hours pe post hoga.");
  }

  const hasEngagementIssue = issues.some((i) => i.category === "engagement");
  if (hasEngagementIssue) {
    recs.push("Video ke end mein CTA do: 'Follow for more' ya 'Comment karo kya lagta hai'.");
  }

  const hasQualityIssue = issues.some((i) => i.category === "quality");
  if (hasQualityIssue) {
    recs.push("AI Edit use karo — captions, effects, aur color grade automatically add hoga.");
  }

  if (totalPosted > 5 && engagementRate > 5) {
    recs.push("Acha perform kar raha hai! Content ko boost karne ke liye paid promotion try karo.");
  }

  recs.push("Consistent raho — minimum 1 video daily. Algorithm ko regular upload pasand hai.");

  return recs;
}
