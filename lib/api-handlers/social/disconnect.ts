import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, getIp } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getPublisher } from "@/lib/publishers/index";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import type { Platform } from "@prisma/client";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { platform: platformRaw } = await params;
  const platform = platformRaw.toUpperCase() as Platform;
  if (!["YOUTUBE", "INSTAGRAM", "FACEBOOK", "TIKTOK"].includes(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }

  await getPublisher(platform).disconnect(auth.workspaceId);
  await prisma.platformJob.updateMany({
    where: { workspaceId: auth.workspaceId, platform, status: { in: ["PENDING", "RETRYING"] } },
    data: { status: "CANCELLED" },
  });
  await audit({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: `social.${platformRaw.toLowerCase()}_disconnected`,
    ip: await getIp(req),
  });
  logger.info("platform_disconnected", { workspaceId: auth.workspaceId, platform });

  return NextResponse.json({ ok: true });
}
