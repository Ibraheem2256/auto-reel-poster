import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, errorResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { formatBytes, formatDuration } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const pageSize = Math.min(50, Math.max(1, Number(searchParams.get("pageSize") ?? 20)));

  try {
    const where = {
      workspaceId: auth.workspaceId,
      ...(status && status !== "ALL" ? { status: status as never } : {}),
    };
    const [videos, total] = await Promise.all([
      prisma.video.findMany({
        where,
        include: {
          driveSource: { select: { folderName: true } },
          scheduledPost: { select: { scheduledAt: true, status: true } },
          platformJobs: {
            select: { id: true, platform: true, status: true, platformPostId: true },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { detectedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.video.count({ where }),
    ]);

    return NextResponse.json({
      videos: videos.map((v) => ({
        ...v,
        fileSize: formatBytes(v.fileSize),
        durationMs: v.durationMs,
        durationLabel: formatDuration(v.durationMs),
      })),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    return errorResponse(err);
  }
}