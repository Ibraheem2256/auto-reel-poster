import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const [sources, videos, newCount] = await Promise.all([
    prisma.driveSource.findMany({
      where: { workspaceId: auth.workspaceId, status: { not: "DISCONNECTED" } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.video.findMany({
      where: { workspaceId: auth.workspaceId },
      select: { id: true },
    }),
    prisma.video.count({
      where: { workspaceId: auth.workspaceId, status: { in: ["VALIDATED", "QUEUED", "SCHEDULED", "PENDING"] } },
    }),
  ]);

  if (sources.length === 0) return NextResponse.json({ connected: false, folders: [] });

  return NextResponse.json({
    connected: true,
    folders: sources.map((s) => ({
      id: s.id,
      folderId: s.folderId,
      folderName: s.folderName,
      status: s.status,
      lastError: s.lastError,
      lastScanAt: s.lastScanAt,
    })),
    videos: videos.length,
    newVideos: newCount,
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { folderId } = await req.json().catch(() => ({}));

  if (folderId) {
    await prisma.driveSource.updateMany({
      where: { workspaceId: auth.workspaceId, folderId },
      data: { status: "DISCONNECTED" },
    });
  } else {
    await prisma.driveSource.updateMany({
      where: { workspaceId: auth.workspaceId },
      data: { status: "DISCONNECTED" },
    });
    await prisma.oAuthToken.deleteMany({ where: { workspaceId: auth.workspaceId, scope: "DRIVE" } });
    await prisma.platformJob.updateMany({
      where: { workspaceId: auth.workspaceId, status: { in: ["PENDING", "RETRYING"] } },
      data: { status: "CANCELLED" },
    });
  }

  return NextResponse.json({ ok: true });
}
