import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, errorResponse, getIp } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { scheduleSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { enqueueValidatedVideos, assignJobsForWorkspace } from "@/lib/scheduler";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const existing = await prisma.schedule.findFirst({
    where: { id, workspaceId: auth.workspaceId },
  });
  if (!existing) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Invalid schedule" }, { status: 400 });
  }

  try {
    const schedule = await prisma.schedule.update({
      where: { id },
      data: {
        name: parsed.data.name,
        timezone: parsed.data.timezone,
        scheduleType: parsed.data.scheduleType,
        postsPerDay: parsed.data.postsPerDay,
        times: parsed.data.times,
        platforms: parsed.data.platforms,
        intervalHours: parsed.data.intervalHours ?? null,
        platformTimes: parsed.data.platformTimes ?? undefined,
        enabled: parsed.data.enabled,
      },
    });
    await audit({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      action: "schedule.updated",
      entityType: "Schedule",
      entityId: schedule.id,
      ip: await getIp(req),
    });

    if (parsed.data.enabled) {
      await enqueueValidatedVideos(auth.workspaceId);
      await assignJobsForWorkspace(auth.workspaceId);
    }

    return NextResponse.json({ schedule });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const existing = await prisma.schedule.findFirst({
    where: { id, workspaceId: auth.workspaceId },
  });
  if (!existing) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  await prisma.schedule.delete({ where: { id } });
  await audit({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: "schedule.deleted",
    entityType: "Schedule",
    entityId: id,
    ip: await getIp(req),
  });
  return NextResponse.json({ ok: true });
}