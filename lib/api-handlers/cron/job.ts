import { NextResponse, type NextRequest } from "next/server";
import { verifyCronRequest } from "@/lib/api";
import { scanAllSources } from "@/lib/drive";
import { enqueueValidatedVideos, assignJobsForAllWorkspaces, assignJobsForWorkspace, processDueJobs, checkInFlightJobs, processRetryQueue, cleanupStaleData } from "@/lib/scheduler";
import { cleanupExpiredTempFiles } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import { getPublisher } from "@/lib/publishers/index";
import { logger } from "@/lib/logger";

const JOBS = ["scan", "publish", "check-status", "retry", "cleanup", "token-check"] as const;
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
        const workspaces = await prisma.workspace.findMany({ where: { automationEnabled: true, paused: false }, select: { id: true } });
        let queued = 0;
        let assigned = 0;
        for (const ws of workspaces) {
          queued += await enqueueValidatedVideos(ws.id);
          assigned += (await assignJobsForWorkspace(ws.id)).scheduled;
        }
        return NextResponse.json({ ok: true, scan, queued, assigned });
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
    }
  } catch (err) {
    logger.error("cron_job_failed", { job, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
