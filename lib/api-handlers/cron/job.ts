import { NextResponse, type NextRequest } from "next/server";
import { verifyCronRequest } from "@/lib/api";
import { scanAllSources } from "@/lib/drive";
import { enqueueValidatedVideos, assignJobsForAllWorkspaces, assignJobsForWorkspace, processDueJobs, checkInFlightJobs, processRetryQueue, cleanupStaleData } from "@/lib/scheduler";
import { ensureQueuedVideoTitles } from "@/lib/content";
import { cleanupExpiredTempFiles } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import { getPublisher } from "@/lib/publishers/index";
import { logger } from "@/lib/logger";

const JOBS = ["scan", "publish", "check-status", "retry", "cleanup", "token-check", "debug"] as const;
type JobName = (typeof JOBS)[number];

export async function POST(req: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  const { job } = await params;
  if (!JOBS.includes(job as JobName)) return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    switch (job) {
      case "scan": {
        const scan = await scanAllSources();
        const queued = await assignJobsForAllWorkspaces();
        // Clean up bad AI titles and generate new ones for queued videos
        const workspaces = await prisma.workspace.findMany({ where: { automationEnabled: true } });
        for (const ws of workspaces) {
          try {
            await ensureQueuedVideoTitles(ws.id, 10);
          } catch (err) {
            logger.warn("title_cleanup_failed", { workspaceId: ws.id, error: String(err) });
          }
        }
        return NextResponse.json({ ok: true, scan, queued });
      }
      case "publish": {
        const result = await processDueJobs();
        return NextResponse.json({ ok: true, ...result });
      }
      case "check-status": {
        const resolved = await checkInFlightJobs();
        return NextResponse.json({ ok: true, resolved });
      }
      case "retry": {
        const processed = await processRetryQueue();
        return NextResponse.json({ ok: true, processed });
      }
      case "cleanup": {
        const temp = await cleanupExpiredTempFiles();
        const stale = await cleanupStaleData();
        return NextResponse.json({ ok: true, temp, stale });
      }
      case "token-check": {
        let refreshed = 0;
        const accounts = await prisma.socialAccount.findMany({
          where: { status: { in: ["CONNECTED", "EXPIRED"] } },
          select: { workspaceId: true, platform: true, id: true },
        });
        for (const account of accounts) {
          try {
            const ok = await getPublisher(account.platform).refreshToken(account.workspaceId);
            if (ok) refreshed += 1;
          } catch (err) {
            logger.warn("token_check_failed", { accountId: account.id, error: String(err) });
          }
        }
        return NextResponse.json({ ok: true, refreshed });
      }
      case "debug": {
        const now = new Date();
        const [jobStatusCounts, workspace, dueJobs, stalledJobs] = await Promise.all([
          prisma.platformJob.groupBy({ by: ["status"], _count: { _all: true } }),
          prisma.workspace.findFirst({ select: { id: true, automationEnabled: true, paused: true } }),
          prisma.platformJob.findMany({
            where: { status: "PENDING", scheduledAt: { lte: now } },
            take: 5,
            select: { id: true, scheduledAt: true, platform: true, videoId: true },
          }),
          prisma.platformJob.findMany({
            where: { status: "PROCESSING" },
            take: 5,
            select: { id: true, startedAt: true, platform: true },
          }),
        ]);
        return NextResponse.json({
          ok: true,
          jobStatusCounts,
          workspace: workspace ? { id: workspace.id, automationEnabled: workspace.automationEnabled, paused: workspace.paused } : null,
          dueJobsNow: dueJobs,
          stalledProcessing: stalledJobs,
          serverTime: now.toISOString(),
        });
      }
    }
  } catch (err) {
    logger.error("cron_job_failed", { job, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
