import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const [
    totalUsers,
    activeUsers,
    accounts,
    videosDetected,
    postsPublished,
    failedJobs,
    queueHealth,
    workspaces,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
    prisma.socialAccount.count(),
    prisma.video.count(),
    prisma.platformJob.count({ where: { status: "SUCCESS" } }),
    prisma.platformJob.count({ where: { status: "FAILED" } }),
    prisma.platformJob.count({ where: { status: { in: ["PENDING", "RETRYING"] }, scheduledAt: { lte: now } } }),
    prisma.workspace.count(),
  ]);

  const recentErrors = await prisma.platformJob.findMany({
    where: { status: "FAILED", updatedAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: { id: true, platform: true, errorCode: true, errorMessage: true, updatedAt: true },
  });

  return NextResponse.json({
    stats: {
      totalUsers,
      activeUsers,
      accounts,
      videosDetected,
      postsPublished,
      failedJobs,
      queueHealth,
      workspaces,
    },
    recentErrors,
    apiVersion: "1.0.0",
  });
}