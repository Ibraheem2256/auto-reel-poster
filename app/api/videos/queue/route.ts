import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, errorResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { formatBytes, formatDuration } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {

    const queued = await prisma.video.findMany({
      where: {
        workspaceId: auth.workspaceId,
        status: { in: ["PENDING", "VALIDATED", "QUEUED", "SCHEDULED"] },
      },
      include: {
        scheduledPost: { select: { scheduledAt: true } },
        platformJobs: {
          select: { id: true, platform: true, status: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { detectedAt: "asc" },
      take: 200,
    });

    const counts = {
      pending: queued.filter((v) => v.status === "PENDING").length,
      validated: queued.filter((v) => v.status === "VALIDATED").length,
      queued: queued.filter((v) => v.status === "QUEUED").length,
      scheduled: queued.filter((v) => v.status === "SCHEDULED").length,
    };

    return NextResponse.json({
      queue: queued.map((v) => ({
        ...v,
        fileSize: formatBytes(v.fileSize),
        durationLabel: formatDuration(v.durationMs),
      })),
      counts,
    });
  } catch (err) {
    return errorResponse(err);
  }
}