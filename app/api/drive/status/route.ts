import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const [source, videos, newCount] = await Promise.all([
    prisma.driveSource.findFirst({
      where: { workspaceId: auth.workspaceId, status: { not: "DISCONNECTED" } },
    }),
    prisma.video.findMany({
      where: { workspaceId: auth.workspaceId },
      select: { id: true },
    }),
    prisma.video.count({
      where: { workspaceId: auth.workspaceId, status: { in: ["VALIDATED", "QUEUED", "SCHEDULED", "PENDING"] } },
    }),
  ]);

  if (!source) return NextResponse.json({ connected: false });

  return NextResponse.json({
    connected: true,
    folderId: source.folderId,
    folderName: source.folderName,
    status: source.status,
    lastError: source.lastError,
    lastScanAt: source.lastScanAt,
    videos: videos.length,
    newVideos: newCount,
    scanIntervalMinutes: Number(process.env.SCAN_INTERVAL_MINUTES ?? 10),
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  await prisma.driveSource.updateMany({
    where: { workspaceId: auth.workspaceId },
    data: { status: "DISCONNECTED" },
  });
  await prisma.oAuthToken.deleteMany({ where: { workspaceId: auth.workspaceId, scope: "DRIVE" } });
  await prisma.platformJob.updateMany({
    where: { workspaceId: auth.workspaceId, status: { in: ["PENDING", "RETRYING"] } },
    data: { status: "CANCELLED" },
  });

  return NextResponse.json({ ok: true });
}