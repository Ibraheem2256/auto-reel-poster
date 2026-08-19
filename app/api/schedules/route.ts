import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, errorResponse, getIp } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { scheduleSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { enqueueValidatedVideos, assignJobsForWorkspace } from "@/lib/scheduler";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const schedules = await prisma.schedule.findMany({
    where: { workspaceId: auth.workspaceId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ schedules });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Invalid schedule" }, { status: 400 });
  }

  try {
    const schedule = await prisma.schedule.create({
      data: {
        workspaceId: auth.workspaceId,
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
      action: "schedule.created",
      entityType: "Schedule",
      entityId: schedule.id,
      ip: await getIp(req),
    });

    if (parsed.data.enabled) {
      await enqueueValidatedVideos(auth.workspaceId);
      await assignJobsForWorkspace(auth.workspaceId);
    }

    return NextResponse.json({ schedule }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}