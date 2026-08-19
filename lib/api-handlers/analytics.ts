import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [
    totalVideos,
    videosInQueue,
    scheduledToday,
    postedToday,
    totalPosted,
    failedJobs,
    accounts,
    last7Days,
  ] = await Promise.all([
    prisma.video.count({ where: { workspaceId: auth.workspaceId } }),
    prisma.video.count({
      where: { workspaceId: auth.workspaceId, status: { in: ["PENDING", "VALIDATED", "QUEUED", "SCHEDULED"] } },
    }),
    prisma.scheduledPost.count({
      where: { workspaceId: auth.workspaceId, scheduledAt: { gte: startOfToday } },
    }),
    prisma.platformJob.count({
      where: {
        workspaceId: auth.workspaceId,
        status: "SUCCESS",
        publishedAt: { gte: startOfToday },
      },
    }),
    prisma.platformJob.count({ where: { workspaceId: auth.workspaceId, status: "SUCCESS" } }),
    prisma.platformJob.count({ where: { workspaceId: auth.workspaceId, status: "FAILED" } }),
    prisma.socialAccount.count({ where: { workspaceId: auth.workspaceId, status: "CONNECTED" } }),
    prisma.platformJob.groupBy({
      by: ["publishedAt"],
      where: { workspaceId: auth.workspaceId, status: "SUCCESS", publishedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      _count: { _all: true },
    }),
  ]);

  const byDay: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    byDay[d.toISOString().slice(0, 10)] = 0;
  }
  for (const row of last7Days) {
    if (row.publishedAt) {
      const key = new Date(row.publishedAt).toISOString().slice(0, 10);
      if (key in byDay) byDay[key] = row._count._all;
    }
  }

  const byPlatform = await prisma.platformJob.groupBy({
    by: ["platform", "status"],
    where: { workspaceId: auth.workspaceId },
    _count: { _all: true },
  });

  const [connectedDriveSources, enabledSchedules, workspace] = await Promise.all([
    prisma.driveSource.count({ where: { workspaceId: auth.workspaceId, status: "CONNECTED" } }),
    prisma.schedule.count({ where: { workspaceId: auth.workspaceId, enabled: true } }),
    prisma.workspace.findUnique({
      where: { id: auth.workspaceId },
      select: { automationEnabled: true, paused: true },
    }),
  ]);

  return NextResponse.json({
    stats: {
      totalVideos,
      videosInQueue,
      scheduledToday,
      postedToday,
      totalPosted,
      failedJobs,
      accounts,
    },
    byDay,
    byPlatform,
    setup: {
      driveConnected: connectedDriveSources > 0,
      schedules: enabledSchedules,
      automationEnabled: workspace?.automationEnabled ?? false,
      paused: workspace?.paused ?? false,
    },
  });
}
