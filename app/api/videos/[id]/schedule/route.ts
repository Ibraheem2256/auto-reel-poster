import { NextRequest, NextResponse } from "next/server";
import { requireAuth, errorResponse, getIp } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { PLATFORM_VIDEO_RULES } from "@/lib/constants";
import type { Platform } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/videos/[id]/schedule — schedule the video at a manually chosen
 * time. Creates a scheduled post + platform jobs for every connected
 * platform that accepts the video's duration. Replaces any existing
 * schedule for the video (reschedule).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const scheduledAt = new Date(body.scheduledAt);
    if (isNaN(scheduledAt.getTime())) {
      return NextResponse.json({ error: "Invalid scheduled time." }, { status: 400 });
    }
    if (scheduledAt.getTime() <= Date.now() + 60_000) {
      return NextResponse.json({ error: "Please pick a time at least 1 minute in the future." }, { status: 400 });
    }

    const video = await prisma.video.findFirst({ where: { id, workspaceId: auth.workspaceId } });
    if (!video) {
      return NextResponse.json({ error: "Video not found." }, { status: 404 });
    }
    if (video.invalidReason) {
      return NextResponse.json(
        { error: `This video is not publishable: ${video.invalidReason}` },
        { status: 400 }
      );
    }
    if (!["PENDING", "VALIDATED", "QUEUED", "SCHEDULED"].includes(video.status)) {
      return NextResponse.json(
        { error: `A ${video.status.toLowerCase().replace(/_/g, " ")} video cannot be scheduled.` },
        { status: 400 }
      );
    }

    const accounts = await prisma.socialAccount.findMany({
      where: { workspaceId: auth.workspaceId, status: "CONNECTED" },
    });
    if (accounts.length === 0) {
      return NextResponse.json(
        { error: "No connected accounts. Connect at least one platform first." },
        { status: 400 }
      );
    }

    const validPlatforms: Platform[] = accounts
      .filter((a) => {
        const rule = PLATFORM_VIDEO_RULES[a.platform];
        return (
          !rule ||
          !video.durationMs ||
          (video.durationMs >= rule.minDurationMs && video.durationMs <= rule.maxDurationMs)
        );
      })
      .map((a) => a.platform);
    if (validPlatforms.length === 0) {
      return NextResponse.json(
        { error: "None of your connected platforms support this video's duration." },
        { status: 400 }
      );
    }

    // Replace any existing schedule for this video (manual reschedule).
    await prisma.platformJob.updateMany({
      where: { videoId: id, status: { in: ["PENDING", "RETRYING", "PROCESSING"] } },
      data: { status: "CANCELLED", errorCode: "RESCHEDULED", errorMessage: "Replaced by a manually chosen time." },
    });
    await prisma.scheduledPost.deleteMany({ where: { videoId: id } });

    const scheduledPost = await prisma.scheduledPost.create({
      data: {
        workspaceId: auth.workspaceId,
        videoId: id,
        // No scheduleId → manual schedule. These fire even when the automation
        // toggle is off, but still respect the global pause switch.
        scheduledAt,
      },
    });
    for (const platform of validPlatforms) {
      const account = accounts.find((a) => a.platform === platform)!;
      await prisma.platformJob.create({
        data: {
          workspaceId: auth.workspaceId,
          videoId: id,
          socialAccountId: account.id,
          scheduledPostId: scheduledPost.id,
          platform,
          scheduledAt,
          status: "PENDING",
        },
      });
    }
    await prisma.video.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt } });

    await audit({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      action: "video.scheduled",
      entityType: "Video",
      entityId: id,
      metadata: { scheduledAt: scheduledAt.toISOString(), platforms: validPlatforms },
      ip: await getIp(req),
    });

    return NextResponse.json({
      ok: true,
      scheduledAt: scheduledAt.toISOString(),
      platforms: validPlatforms,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * DELETE /api/videos/[id]/schedule — remove a manual schedule and put the
 * video back into the queue.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  try {
    const video = await prisma.video.findFirst({ where: { id, workspaceId: auth.workspaceId } });
    if (!video) {
      return NextResponse.json({ error: "Video not found." }, { status: 404 });
    }

    await prisma.platformJob.updateMany({
      where: { videoId: id, status: { in: ["PENDING", "RETRYING", "PROCESSING"] } },
      data: { status: "CANCELLED", errorCode: "UNSCHEDULED", errorMessage: "Schedule removed by the user." },
    });
    await prisma.scheduledPost.deleteMany({ where: { videoId: id } });
    await prisma.video.update({ where: { id }, data: { status: "QUEUED", scheduledAt: null } });

    await audit({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      action: "video.unscheduled",
      entityType: "Video",
      entityId: id,
      ip: await getIp(req),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}