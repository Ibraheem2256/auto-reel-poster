import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, checkRateLimit, getIp } from "@/lib/api";
import { getDriveClient } from "@/lib/google";
import { scanDriveSource } from "@/lib/drive";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { enqueueValidatedVideos, assignJobsForWorkspace } from "@/lib/scheduler";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/utils";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const rate = await checkRateLimit(req, "drive-scan", 6, 60);
  if (rate) return rate;

  const source = await prisma.driveSource.findFirst({
    where: { workspaceId: auth.workspaceId, status: { not: "DISCONNECTED" } },
  });
  if (!source) {
    return NextResponse.json({ error: "No Drive folder is connected." }, { status: 404 });
  }

  try {
    const drive = await getDriveClient(auth.workspaceId);
    const result = await scanDriveSource(auth.workspaceId, source, drive);

    // Queue new videos and assign schedule slots automatically.
    const queued = await enqueueValidatedVideos(auth.workspaceId);
    const assigned = await assignJobsForWorkspace(auth.workspaceId);

    await audit({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      action: "drive.scan_manual",
      metadata: { result, queued, assigned },
      ip: await getIp(req),
    });
    logger.info("drive_scan_manual", { workspaceId: auth.workspaceId, ...result });

    return NextResponse.json({ ok: true, result, queued, assigned });
  } catch (err) {
    const message = getErrorMessage(err);
    await prisma.driveSource.update({
      where: { id: source.id },
      data: { status: "ERROR", lastError: message.slice(0, 500) },
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}