import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/logger";
import {
  PLATFORM_VIDEO_RULES,
  MAX_ATTEMPTS,
  RETRY_BACKOFF_MINUTES,
  BEST_TIME_WINDOWS,
} from "@/lib/constants";
import { getErrorMessage } from "@/lib/utils";
import { getPublisher } from "@/lib/publishers/index";
import { PublisherError } from "@/lib/publishers/types";
import { buildContentFor } from "@/lib/content";
import { editVideoForPublish, cleanupEditedFile } from "@/lib/editor";
import { getBestHoursForPlatform } from "@/lib/timing-optimizer";
import type {
  Platform,
  PlatformJob,
  Schedule,
  SocialAccount,
  Video,
  VideoStatus,
  Workspace,
} from "@prisma/client";

type RichJob = PlatformJob & { workspace: Workspace; video: Video; socialAccount: SocialAccount | null };

// ---------------------------------------------------------------------------
// Timezone-safe scheduling using only Intl (no extra deps).
// Timestamps are stored in UTC; slots are computed in the user's timezone.
// ---------------------------------------------------------------------------

function getParts(date: Date, tz: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  let hour = get("hour");
  if (hour === 24) hour = 0;
  return { year: get("year"), month: get("month"), day: get("day"), hour, minute: get("minute") };
}

export function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string
): Date {
  // Start from the desired wall-clock time interpreted as UTC, then correct
  // by the timezone offset. Iterates a few times to settle DST edge cases.
  let guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  for (let i = 0; i < 3; i++) {
    const p = getParts(guess, tz);
    const targetClock = h * 60 + mi;
    const zonedClock = p.hour * 60 + p.minute;
    const dayDelta = ((p.year - y) * 372 + (p.month - mo) * 31 + (p.day - d)) * 86_400_000;
    const deltaMs = dayDelta + (zonedClock - targetClock) * 60_000;
    if (deltaMs === 0) break;
    guess = new Date(guess.getTime() - deltaMs);
  }
  return guess;
}

export function startOfZonedDay(date: Date, tz: string): Date {
  const p = getParts(date, tz);
  return zonedToUtc(p.year, p.month, p.day, 0, 0, tz);
}

function dayKey(date: Date, tz: string): string {
  const p = getParts(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Parse "HH:MM" into minutes. */
function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Generate the next `count` publish slots for a schedule starting from `after`.
 * Returns UTC Dates sorted ascending, unique per day+time.
 * When workspaceId is provided, uses actual performance data for BEST_TIMES mode.
 */
export async function nextSlotsForSchedule(schedule: Schedule, after: Date, count: number, workspaceId?: string): Promise<Date[]> {
  const tz = schedule.timezone;
  const slots: Date[] = [];
  const seen = new Set<string>();
  let cursor = startOfZonedDay(after, tz);

  while (slots.length < count) {
    const day = getParts(cursor, tz);
    const candidates: Date[] = [];

    if (schedule.scheduleType === "FIXED_TIMES") {
      const times = (schedule.times as string[]) ?? [];
      for (const time of times) {
        const [h, m] = time.split(":").map(Number);
        candidates.push(zonedToUtc(day.year, day.month, day.day, h, m, tz));
      }
    } else if (schedule.scheduleType === "INTERVAL") {
      const perDay = Math.max(1, schedule.postsPerDay);
      const interval = schedule.intervalHours ?? 4;
      // Spread posts across the day respecting the minimum interval.
      const totalSpan = Math.min(24, perDay * interval);
      const step = Math.max(interval, Math.floor(totalSpan / perDay));
      for (let i = 0; i < perDay; i++) {
        const hour = Math.min(23, 8 + i * step);
        candidates.push(zonedToUtc(day.year, day.month, day.day, hour, 0, tz));
      }
    } else if (schedule.scheduleType === "PLATFORM_SPECIFIC") {
      // PLATFORM_SPECIFIC: use the primary platform's times as day slots.
      const platformTimes = (schedule.platformTimes as Record<string, string[]> | null) ?? {};
      const primary = (schedule.platforms as Platform[])[0] ?? "TIKTOK";
      const times = platformTimes[primary] ?? ((schedule.times as string[]) ?? []);
      for (const time of times) {
        const [h, m] = time.split(":").map(Number);
        candidates.push(zonedToUtc(day.year, day.month, day.day, h, m, tz));
      }
    } else if (schedule.scheduleType === "BEST_TIMES") {
      const platformsList = (schedule.platforms as Platform[]) ?? [];
      const perDay = Math.max(1, schedule.postsPerDay);

      // Try data-driven hours first, fall back to static windows
      let hours: number[] = [];
      if (workspaceId) {
        try {
          const dataHours = await getBestHoursForPlatform(workspaceId, platformsList[0] ?? "TIKTOK", perDay);
          hours = dataHours;
        } catch {
          // Fall through to static windows
        }
      }

      // Fallback to static BEST_TIME_WINDOWS if no data-driven hours
      if (hours.length === 0) {
        const hourSet = new Set<number>();
        for (const p of platformsList) {
          for (const w of BEST_TIME_WINDOWS[p] ?? []) {
            for (let h = w.start; h < w.end; h++) hourSet.add(h);
          }
        }
        hours = [...hourSet].sort((a, b) => a - b).slice(0, perDay);
      }

      for (const h of hours) {
        candidates.push(zonedToUtc(day.year, day.month, day.day, h, 0, tz));
      }
    }

    candidates.sort((a, b) => a.getTime() - b.getTime());
    for (const c of candidates) {
      if (c.getTime() <= after.getTime()) continue;
      const key = `${c.getTime()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      slots.push(c);
      if (slots.length >= count) break;
    }
    cursor = new Date(cursor.getTime() + 86_400_000);
  }

  return slots;
}

/** Next hourly slots inside a platform's peak-activity windows (user's local time).
 *  Uses actual performance data when available, falls back to static windows. */
export async function nextBestSlotsForPlatform(
  platform: Platform,
  tz: string,
  after: Date,
  count: number,
  workspaceId?: string
): Promise<Date[]> {
  // Try data-driven hours first
  let hours: number[] = [];
  if (workspaceId) {
    try {
      hours = await getBestHoursForPlatform(workspaceId, platform, count);
    } catch {
      // Fall through to static windows
    }
  }

  // Fallback to static BEST_TIME_WINDOWS
  if (hours.length === 0) {
    const windows = BEST_TIME_WINDOWS[platform] ?? [];
    for (const w of windows) {
      for (let h = w.start; h < w.end; h++) hours.push(h);
    }
  }

  const slots: Date[] = [];
  let cursor = startOfZonedDay(after, tz);

  while (slots.length < count) {
    const day = getParts(cursor, tz);
    for (const h of hours) {
      const c = zonedToUtc(day.year, day.month, day.day, h, 0, tz);
      if (c.getTime() <= after.getTime()) continue;
      slots.push(c);
      if (slots.length >= count) break;
    }
    if (slots.length >= count) break;
    cursor = new Date(cursor.getTime() + 86_400_000);
  }

  return slots;
}

// ---------------------------------------------------------------------------
// Queue management
// ---------------------------------------------------------------------------

export function queueOrderBy(order: Workspace["queueOrder"]): Record<string, "asc" | "desc"> {
  switch (order) {
    case "NEWEST_FIRST":
      return { detectedAt: "desc" };
    case "RANDOM":
      return { id: "asc" }; // random via id shuffle below
    default:
      return { detectedAt: "asc" };
  }
}

/** Sorted peak hours (0–23) for a platform, using data-driven timing when available. */
async function peakHoursForPlatform(platform: Platform, workspaceId?: string): Promise<number[]> {
  // Try data-driven hours first
  if (workspaceId) {
    try {
      const hours = await getBestHoursForPlatform(workspaceId, platform, 8);
      if (hours.length > 0) return hours;
    } catch {
      // Fall through to static windows
    }
  }

  // Fallback to static BEST_TIME_WINDOWS
  const hours = new Set<number>();
  for (const w of BEST_TIME_WINDOWS[platform] ?? []) {
    for (let h = w.start; h < w.end; h++) hours.add(h);
  }
  return [...hours].sort((a, b) => a - b);
}

/**
 * Move validated videos into the queue (status VALIDATED -> QUEUED).
 * Never touches already-queued or processed videos.
 */
export async function enqueueValidatedVideos(workspaceId: string): Promise<number> {
  const updated = await prisma.video.updateMany({
    where: {
      workspaceId,
      status: "VALIDATED",
      driveSource: { status: "CONNECTED" },
    },
    data: { status: "QUEUED" },
  });
  return updated.count;
}

/**
 * Assign the next free slot to queued videos and create platform jobs.
 * Each video gets exactly one scheduled post. Only platforms with a connected
 * account receive a job.
 */
export async function assignJobsForWorkspace(workspaceId: string): Promise<{ scheduled: number }> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { schedules: { where: { enabled: true } } },
  });
  if (!workspace) return { scheduled: 0 };

  const schedules = workspace.schedules;
  if (schedules.length === 0) return { scheduled: 0 };

  const accounts = await prisma.socialAccount.findMany({
    where: { workspaceId, status: "CONNECTED" },
  });
  if (accounts.length === 0) return { scheduled: 0 };

  const queued = await prisma.video.findMany({
    where: {
      workspaceId,
      status: { in: ["QUEUED", "VALIDATED"] },
      scheduledPost: null,
      invalidReason: null,
    },
    orderBy: workspace.queueOrder === "RANDOM" ? undefined : queueOrderBy(workspace.queueOrder),
  });

  if (workspace.queueOrder === "RANDOM") {
    queued.sort(() => Math.random() - 0.5);
  }
  if (queued.length === 0) return { scheduled: 0 };

  // Build one combined slot list across all enabled schedules.
  // Also enforce postsPerDay limit: count how many jobs each schedule already
  // has for today (published + pending + processing) and only generate slots
  // for the remaining capacity.
  const now = new Date();
  const slots: Date[] = [];

  for (const schedule of schedules) {
    const tz = schedule.timezone;
    const dayStart = startOfZonedDay(now, tz);

    // Count jobs already published or pending for today under this schedule
    const todayJobCount = await prisma.platformJob.count({
      where: {
        workspaceId,
        status: { in: ["SUCCESS", "PENDING", "PROCESSING", "RETRYING"] },
        scheduledAt: { gte: dayStart },
        scheduledPost: { schedule: { id: schedule.id } },
      },
    });

    const remaining = Math.max(0, schedule.postsPerDay - todayJobCount);
    if (remaining === 0) continue;

    const newSlots = await nextSlotsForSchedule(schedule, now, Math.min(remaining, 50), workspaceId);
    slots.push(...newSlots);
  }
  slots.sort((a, b) => a.getTime() - b.getTime());

  let scheduled = 0;
  // Tracks how many videos each schedule assigned per platform per zoned day,
  // so peak hours are consumed in order and postsPerDay is respected.
  const bestDayCounts = new Map<string, Map<Platform, Map<string, number>>>();
  for (let i = 0; i < queued.length && i < slots.length; i++) {
    const video = queued[i];
    const slot = slots[i];

    const schedule = schedules[i % schedules.length];
    const platformList = (schedule.platforms as Platform[]) ?? [];
    const selectedPlatforms = platformList.filter((p) => accounts.some((a) => a.platform === p));
    if (selectedPlatforms.length === 0) continue;

    const videoDuration = video.durationMs ?? 0;
    const validPlatforms = selectedPlatforms.filter((p) => {
      const rule = PLATFORM_VIDEO_RULES[p];
      return !rule || (videoDuration === 0 || (videoDuration >= rule.minDurationMs && videoDuration <= rule.maxDurationMs));
    });
    if (validPlatforms.length === 0) {
      await prisma.video.update({
        where: { id: video.id },
        data: { status: "INVALID", invalidReason: "Video duration is not supported by the selected platforms." },
      });
      continue;
    }

    const isBestTimes = schedule.scheduleType === "BEST_TIMES";
    const platformSlots = new Map<Platform, Date>();
    if (isBestTimes) {
      const tz = schedule.timezone;
      const day = getParts(slot, tz);
      const dayKeyStr = `${day.year}-${day.month}-${day.day}`;
      let counts = bestDayCounts.get(schedule.id);
      if (!counts) {
        counts = new Map();
        bestDayCounts.set(schedule.id, counts);
      }
      for (const p of validPlatforms) {
        const hours = await peakHoursForPlatform(p, workspaceId);
        const perPlatform = counts.get(p) ?? new Map<string, number>();
        const idx = perPlatform.get(dayKeyStr) ?? 0;
        const hour = hours[idx % Math.max(1, hours.length)];
        let c = zonedToUtc(day.year, day.month, day.day, hour, 0, tz);
        if (c.getTime() <= Date.now()) {
          const nextSlots = await nextBestSlotsForPlatform(p, tz, new Date(), 1, workspaceId);
          c = nextSlots[0];
        }
        perPlatform.set(dayKeyStr, idx + 1);
        counts.set(p, perPlatform);
        platformSlots.set(p, c);
      }
      const first = Math.min(...[...platformSlots.values()].map((d) => d.getTime()));
      if (first <= Date.now()) continue;
    } else if (!slot || slot.getTime() <= Date.now()) {
      continue;
    }

    const scheduledAt = isBestTimes
      ? new Date(Math.min(...[...platformSlots.values()].map((d) => d.getTime())))
      : slot;

    await prisma.$transaction(async (tx) => {
      const scheduledPost = await tx.scheduledPost.create({
        data: {
          workspaceId,
          videoId: video.id,
          scheduleId: schedule.id,
          scheduledAt,
        },
      });
      for (const platform of validPlatforms) {
        const account = accounts.find((a) => a.platform === platform)!;
        await tx.platformJob.create({
          data: {
            workspaceId,
            videoId: video.id,
            socialAccountId: account.id,
            scheduledPostId: scheduledPost.id,
            platform,
            scheduledAt: isBestTimes ? platformSlots.get(platform)! : scheduledAt,
            status: "PENDING",
          },
        });
      }
      await tx.video.update({
        where: { id: video.id },
        data: { status: "SCHEDULED", scheduledAt },
      });
    });
    scheduled += 1;
  }

  return { scheduled };
}

export async function assignJobsForAllWorkspaces(): Promise<number> {
  const workspaces = await prisma.workspace.findMany({ where: { automationEnabled: true, paused: false } });
  let total = 0;
  for (const ws of workspaces) {
    const res = await assignJobsForWorkspace(ws.id);
    total += res.scheduled;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

async function claimDueJobs(batchSize: number): Promise<RichJob[]> {
  const now = new Date();
  const due = await prisma.platformJob.findMany({
    where: {
      status: "PENDING",
      scheduledAt: { lte: now },
      workspace: { paused: false },
      // Manual schedules (from queue page) always fire.
      // Automatic schedules need the automation toggle on.
      OR: [
        { scheduledPost: { is: null } },
        { scheduledPost: { scheduleId: null } },
        { workspace: { automationEnabled: true } },
      ],
    },
    include: {
      video: true,
      socialAccount: true,
      scheduledPost: true,
      workspace: true,
    },
    orderBy: { scheduledAt: "asc" },
    take: batchSize,
  });
  if (due.length === 0) return [];

  const ids = due.map((j) => j.id);
  const claim = await prisma.platformJob.updateMany({
    where: { id: { in: ids }, status: "PENDING" },
    data: { status: "PROCESSING", startedAt: now, attemptCount: { increment: 1 } },
  });
  return claim.count > 0 ? (due as RichJob[]) : [];
}

export async function processDueJobs(batchSize = 10): Promise<{ processed: number; failed: number }> {
  const jobs = await claimDueJobs(batchSize);
  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await runJob(job);
      processed += 1;
    } catch (err) {
      failed += 1;
      logger.error("job_unhandled_error", { jobId: job.id, error: getErrorMessage(err) });
    }
  }
  return { processed, failed };
}

async function runJob(
  job: RichJob,
  contentOverride?: { title?: string; caption?: string; description?: string; hashtags?: string[] },
  opts?: { videoFilePath?: string; onStage?: (stage: string) => void }
) {
  const workspace = job.workspace;
  const video = job.video;
  const content =
    contentOverride &&
    (contentOverride.title !== undefined || contentOverride.caption !== undefined ||
      contentOverride.description !== undefined || contentOverride.hashtags !== undefined)
      ? {
          title: contentOverride.title ?? "",
          caption: contentOverride.caption ?? "",
          description: contentOverride.description ?? "",
          hashtags: contentOverride.hashtags ?? [],
          aiGenerated: false,
        }
      : await buildContentFor({ video, workspace, platform: job.platform });

  // Persist the AI title on the video so it shows in the queue/posts.
  if (content.aiGenerated && content.title?.trim() && !video.title) {
    await prisma.video.update({ where: { id: video.id }, data: { title: content.title.trim() } });
  }

  // Auto-edit: apply the per-video edit spec (or legacy defaults).
  let editedPath: string | undefined = opts?.videoFilePath;
  let ownEdit = false;
  if (!editedPath && workspace.autoEditEnabled) {
    try {
      opts?.onStage?.("edit");
      const edit = await editVideoForPublish({
        workspaceId: workspace.id,
        driveFileId: video.driveFileId,
        hookText: content.title || video.fileName,
        durationMs: video.durationMs,
        spec: video.editSpec as never,
        onStage: opts?.onStage,
      });
      editedPath = edit.filePath;
      ownEdit = true;
    } catch (err) {
      // Editing is best-effort: if it fails, publish the original.
      logger.warn("job_edit_skipped", { jobId: job.id, videoId: video.id, error: getErrorMessage(err) });
    }
  }

  try {
    const publisher = getPublisher(job.platform);

    // Pre-publish confirmation: validate everything before uploading
    if (publisher.prePublishCheck) {
      const checkResult = await publisher.prePublishCheck({
        workspace,
        video,
        job: { ...job, videoId: job.videoId },
        title: content.title,
        caption: content.caption,
        description: content.description,
        hashtags: content.hashtags,
        videoFilePath: editedPath,
      });

      if (!checkResult.ok) {
        const failedChecks = checkResult.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.message}`);
        logger.warn("pre_publish_check_failed", {
          jobId: job.id,
          platform: job.platform,
          videoId: video.id,
          failedChecks,
        });

        // Create notification for failed checks
        await prisma.notification.create({
          data: {
            workspaceId: job.workspaceId,
            type: "PUBLISH_FAILED",
            title: `Pre-publish check failed on ${job.platform}`,
            message: `"${video.fileName}": ${failedChecks.join("; ")}`,
          },
        });

        throw new PublisherError(
          "PRE_PUBLISH_CHECK_FAILED",
          `Pre-publish validation failed: ${failedChecks.join("; ")}`,
          { retryable: false }
        );
      }

      logger.info("pre_publish_check_passed", {
        jobId: job.id,
        platform: job.platform,
        videoId: video.id,
        checks: checkResult.checks.map((c) => c.name),
      });
    }

    const result = await publisher.publish({
      workspace,
      video,
      job: { ...job, videoId: job.videoId },
      title: content.title,
      caption: content.caption,
      description: content.description,
      hashtags: content.hashtags,
      videoFilePath: editedPath,
    });

    await prisma.platformJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCESS",
        publishedAt: new Date(),
        platformPostId: result.postId,
        platformPostUrl: result.postUrl,
        errorCode: null,
        errorMessage: null,
      },
    });
    await refreshVideoStatus(job.workspaceId, video.id);
    logger.info("job_published", { jobId: job.id, platform: job.platform, videoId: video.id });

    await prisma.notification.create({
      data: {
        workspaceId: job.workspaceId,
        type: "VIDEO_PUBLISHED",
        title: `Published to ${job.platform}`,
        message: `"${video.fileName}" was published to ${job.platform}.`,
      },
    });
  } catch (err) {
    const isPublisherError = err instanceof PublisherError;
    const code = isPublisherError ? (err as PublisherError).code : "UNKNOWN_ERROR";
    const message = isPublisherError ? err.message : getErrorMessage(err);
    const retryable = isPublisherError ? (err as PublisherError).retryable : true;

    const nextAttempt = job.attemptCount + 1;
    if (retryable && nextAttempt <= MAX_ATTEMPTS) {
      const delayMin = RETRY_BACKOFF_MINUTES[Math.min(nextAttempt - 1, RETRY_BACKOFF_MINUTES.length - 1)];
      await prisma.platformJob.update({
        where: { id: job.id },
        data: {
          status: "RETRYING",
          nextRetryAt: new Date(Date.now() + delayMin * 60_000),
          errorCode: code,
          errorMessage: message.slice(0, 2000),
        },
      });
      logger.warn("job_will_retry", { jobId: job.id, code, attempt: nextAttempt, delayMin });
    } else {
      await prisma.platformJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          errorCode: code,
          errorMessage: message.slice(0, 2000),
          retryable,
        },
      });
      await refreshVideoStatus(job.workspaceId, video.id);
      logger.error("job_failed", { jobId: job.id, code, message: message.slice(0, 300) });
      if (code !== "COPYRIGHT_REJECTED") {
        await prisma.notification.create({
          data: {
            workspaceId: job.workspaceId,
            type: "PUBLISH_FAILED",
            title: `Publishing failed on ${job.platform}`,
            message: `"${video.fileName}": ${message.slice(0, 300)}`,
          },
        });
      }
    }
  } finally {
    // Remove the edited temp file (only if we created it for this job).
    if (ownEdit && editedPath) {
      await cleanupEditedFile(editedPath).catch(() => {});
    }
  }
}

/** Recompute the video-level status from its jobs. */
export async function refreshVideoStatus(workspaceId: string, videoId: string): Promise<void> {
  const jobs = await prisma.platformJob.findMany({
    where: { workspaceId, videoId, status: { not: "CANCELLED" } },
    select: { status: true },
  });

  // If all jobs are cancelled, check if there were ever any non-cancelled jobs
  if (jobs.length === 0) {
    const hadJobs = await prisma.platformJob.findFirst({
      where: { workspaceId, videoId },
      select: { id: true },
    });
    // Had jobs but all cancelled => FAILED; no jobs at all => no change
    if (hadJobs) {
      await prisma.video.update({
        where: { id: videoId },
        data: { status: "FAILED" },
      });
    }
    return;
  }

  const allSuccess = jobs.every((j) => j.status === "SUCCESS");
  const anySuccess = jobs.some((j) => j.status === "SUCCESS");
  const anyActive = jobs.some((j) => ["PENDING", "PROCESSING", "RETRYING"].includes(j.status));

  let status: VideoStatus;
  if (allSuccess) status = "PUBLISHED";
  else if (anyActive) status = "SCHEDULED";
  else if (anySuccess) status = "PARTIALLY_PUBLISHED";
  else status = "FAILED";

  await prisma.video.update({
    where: { id: videoId },
    data: { status, publishedAt: status === "PUBLISHED" ? new Date() : undefined },
  });
  if (status === "PUBLISHED") {
    await prisma.scheduledPost.updateMany({
      where: { videoId },
      data: { status: "PUBLISHED" },
    });
  }
}

// ---------------------------------------------------------------------------
// Status checks / retries
// ---------------------------------------------------------------------------

export async function checkInFlightJobs(maxAgeMs = 30 * 60_000): Promise<number> {
  const stale = await prisma.platformJob.findMany({
    where: {
      status: "PROCESSING",
      startedAt: { lt: new Date(Date.now() - maxAgeMs) },
    },
    take: 50,
  });
  let resolved = 0;
  for (const job of stale) {
    try {
      // Force-cancel jobs stuck for more than 24 hours — they'll never complete.
      const ageMs = Date.now() - new Date(job.startedAt!).getTime();
      if (ageMs > 24 * 60 * 60_000) {
        await prisma.platformJob.update({
          where: { id: job.id },
          data: { status: "FAILED", errorCode: "STUCK_TIMEOUT", errorMessage: "Job stuck in PROCESSING for over 24 hours. Force-cancelled." },
        });
        await refreshVideoStatus(job.workspaceId, job.videoId);
        resolved += 1;
        continue;
      }

      if (!job.platformPostId) {
        // Upload never confirmed; treat as retryable failure.
        await prisma.platformJob.update({
          where: { id: job.id },
          data: { status: "RETRYING", nextRetryAt: new Date(Date.now() + 5 * 60_000), errorCode: "TIMEOUT", errorMessage: "Upload did not complete within the timeout." },
        });
        resolved += 1;
        continue;
      }
      const status = await getPublisher(job.platform).checkStatus(job.workspaceId, job.platformPostId, job.videoId);
      if (status.status === "published") {
        await prisma.platformJob.update({
          where: { id: job.id },
          data: { status: "SUCCESS", publishedAt: new Date() },
        });
        await refreshVideoStatus(job.workspaceId, job.videoId);

        // Save metrics if returned
        if (status.views !== undefined) {
          await prisma.performanceMetric.upsert({
            where: {
              workspaceId_platform_platformPostId: {
                workspaceId: job.workspaceId,
                platform: job.platform,
                platformPostId: job.platformPostId,
              },
            },
            create: {
              workspaceId: job.workspaceId,
              videoId: job.videoId,
              platform: job.platform,
              platformPostId: job.platformPostId,
              views: status.views || 0,
              likes: status.likes || 0,
              comments: status.comments || 0,
              shares: 0,
            },
            update: {
              views: status.views || 0,
              likes: status.likes || 0,
              comments: status.comments || 0,
              fetchedAt: new Date(),
            },
          });
        }
      } else if (status.status === "failed") {
        await prisma.platformJob.update({
          where: { id: job.id },
          data: { status: "FAILED", errorCode: "PLATFORM_FAILED", errorMessage: "Platform reported the post as failed." },
        });
        await refreshVideoStatus(job.workspaceId, job.videoId);
      } else {
        // Still pending on the platform; keep the job PROCESSING until it ages further.
        await prisma.platformJob.update({
          where: { id: job.id },
          data: { startedAt: new Date() },
        });
      }
      resolved += 1;
    } catch (err) {
      logger.warn("status_check_failed", { jobId: job.id, error: getErrorMessage(err) });
    }
  }
  return resolved;
}

/**
 * Publish a single video immediately to all connected platforms.
 * Cancels any pending scheduled jobs for the video to avoid double posting.
 */
export async function publishVideoNow(
  workspaceId: string,
  videoId: string,
  contentOverride?: { title?: string; caption?: string; description?: string; hashtags?: string[] },
  onStage?: (stage: string) => void
): Promise<{ platform: Platform; status: string }[]> {
  const video = await prisma.video.findFirst({ where: { id: videoId, workspaceId } });
  if (!video) {
    throw new AppError("VIDEO_NOT_FOUND", "Video not found.", { status: 404 });
  }
  if (video.invalidReason) {
    throw new AppError("VIDEO_INVALID", `This video is not publishable: ${video.invalidReason}`, { status: 400 });
  }
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) {
    throw new AppError("NO_WORKSPACE", "Workspace not found.", { status: 404 });
  }

  const accounts = await prisma.socialAccount.findMany({ where: { workspaceId, status: "CONNECTED" } });
  if (accounts.length === 0) {
    throw new AppError("NO_ACCOUNTS", "No connected accounts. Connect at least one platform first.", { status: 400 });
  }

  await prisma.platformJob.updateMany({
    where: { videoId, status: { in: ["PENDING", "RETRYING", "PROCESSING"] } },
    data: { status: "CANCELLED", errorCode: "POSTED_NOW", errorMessage: "Video was posted manually." },
  });
  await prisma.scheduledPost.deleteMany({ where: { videoId } });

  // Edit once for all platforms using the per-video spec. Best-effort: on
  // failure we publish the original Drive file.
  let editedPath: string | undefined;
  if (workspace.autoEditEnabled) {
    try {
      onStage?.("edit");
      const edit = await editVideoForPublish({
        workspaceId,
        driveFileId: video.driveFileId,
        hookText: contentOverride?.title || video.title || video.fileName,
        durationMs: video.durationMs,
        spec: video.editSpec as never,
        onStage,
      });
      editedPath = edit.filePath;
    } catch (err) {
      logger.warn("post_now_edit_skipped", { videoId, error: getErrorMessage(err) });
    }
  }

  const results: { platform: Platform; status: string }[] = [];
  try {
    for (const account of accounts) {
      const rule = PLATFORM_VIDEO_RULES[account.platform];
      if (rule && video.durationMs && (video.durationMs < rule.minDurationMs || video.durationMs > rule.maxDurationMs)) {
        continue;
      }
      const job = await prisma.platformJob.create({
        data: {
          workspaceId,
          videoId,
          socialAccountId: account.id,
          platform: account.platform,
          scheduledAt: new Date(),
          status: "PENDING",
        },
      });
      const rich = (await prisma.platformJob.findUnique({
        where: { id: job.id },
        include: { video: true, socialAccount: true, scheduledPost: true, workspace: true },
      })) as RichJob;
      onStage?.(`upload:${account.platform}`);
      await runJob(rich, contentOverride, { videoFilePath: editedPath, onStage });
      const updated = await prisma.platformJob.findUnique({ where: { id: job.id }, select: { status: true } });
      results.push({ platform: account.platform, status: updated?.status ?? "UNKNOWN" });
    }
  } finally {
    if (editedPath) await cleanupEditedFile(editedPath).catch(() => {});
  }

  await refreshVideoStatus(workspaceId, videoId);
  logger.info("video_posted_now", { workspaceId, videoId, results });
  return results;
}

export async function processRetryQueue(): Promise<number> {
  const due = await prisma.platformJob.findMany({
    where: {
      status: "RETRYING",
      nextRetryAt: { lte: new Date() },
      workspace: { paused: false },
      OR: [
        { workspace: { automationEnabled: true } },
        { scheduledPost: { is: null } },
        { scheduledPost: { scheduleId: null } },
      ],
    },
    include: { video: true, socialAccount: true, scheduledPost: true, workspace: true },
    orderBy: { nextRetryAt: "asc" },
    take: 10,
  });
  let processed = 0;
  for (const job of due) {
    await prisma.platformJob.update({
      where: { id: job.id },
      data: { status: "PROCESSING", startedAt: new Date() },
    });
    try {
      await runJob(job as RichJob);
      processed += 1;
    } catch (err) {
      logger.error("retry_run_failed", { jobId: job.id, error: getErrorMessage(err) });
    }
  }
  return processed;
}

/** Cleanup: cancel stale scheduled posts / mark videos whose jobs never started. */
export async function cleanupStaleData(): Promise<number> {
  let cleaned = 0;

  // 1. Find stale PENDING/RETRYING PlatformJobs older than 2 days
  const staleJobs = await prisma.platformJob.findMany({
    where: {
      status: { in: ["PENDING", "RETRYING"] },
      scheduledAt: { lt: new Date(Date.now() - 2 * 86_400_000) },
    },
    select: { id: true, workspaceId: true, videoId: true },
  });

  if (staleJobs.length > 0) {
    await prisma.platformJob.updateMany({
      where: {
        status: { in: ["PENDING", "RETRYING"] },
        scheduledAt: { lt: new Date(Date.now() - 2 * 86_400_000) },
      },
      data: { status: "CANCELLED", errorCode: "STALE", errorMessage: "Job was never processed within 2 days." },
    });
    cleaned += staleJobs.length;
  }

  // 2. Find old ScheduledPosts that are past due (>1 day old)
  //    Cancel their PlatformJobs and delete the scheduledPost so videos can be rescheduled
  const staleScheduledPosts = await prisma.scheduledPost.findMany({
    where: {
      scheduledAt: { lt: new Date(Date.now() - 86_400_000) },
      status: "SCHEDULED",
    },
    select: { id: true, videoId: true, workspaceId: true },
  });

  if (staleScheduledPosts.length > 0) {
    const staleIds = staleScheduledPosts.map((sp) => sp.id);
    const videoIds = [...new Set(staleScheduledPosts.map((sp) => sp.videoId))];

    // Cancel all PENDING/RETRYING jobs for these scheduled posts
    await prisma.platformJob.updateMany({
      where: {
        scheduledPostId: { in: staleIds },
        status: { in: ["PENDING", "RETRYING", "PROCESSING"] },
      },
      data: { status: "CANCELLED", errorCode: "STALE_SCHEDULE", errorMessage: "ScheduledPost was older than 1 day." },
    });

    // Delete the stale scheduled posts
    await prisma.scheduledPost.deleteMany({ where: { id: { in: staleIds } } });

    // Reset video status back to QUEUED so they can be picked up again
    await prisma.video.updateMany({
      where: { id: { in: videoIds }, status: "SCHEDULED" },
      data: { status: "QUEUED", scheduledAt: null },
    });

    cleaned += staleScheduledPosts.length;
  }

  // 3. Refresh video status for affected videos from stale jobs
  if (staleJobs.length > 0) {
    const affectedVideos = new Map<string, string>();
    for (const job of staleJobs) {
      affectedVideos.set(`${job.workspaceId}:${job.videoId}`, `${job.workspaceId}:${job.videoId}`);
    }
    for (const key of affectedVideos.keys()) {
      const [wsId, vidId] = key.split(":");
      await refreshVideoStatus(wsId, vidId);
    }
  }

  return cleaned;
}