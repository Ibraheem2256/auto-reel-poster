import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, getIp } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { automationSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { enqueueValidatedVideos, assignJobsForWorkspace } from "@/lib/scheduler";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const workspace = await prisma.workspace.findUnique({
    where: { id: auth.workspaceId },
    select: { automationEnabled: true, paused: true },
  });
  return NextResponse.json(workspace ?? { automationEnabled: false, paused: false });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  const parsed = automationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const workspace = await prisma.workspace.update({
    where: { id: auth.workspaceId },
    data: {
      automationEnabled: parsed.data.enabled,
      ...(parsed.data.paused !== undefined ? { paused: parsed.data.paused } : {}),
    },
  });

  // When enabling, kick off queueing immediately.
  if (parsed.data.enabled) {
    await enqueueValidatedVideos(auth.workspaceId);
    await assignJobsForWorkspace(auth.workspaceId);
  }

  await audit({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: parsed.data.paused ? "automation.paused" : parsed.data.enabled ? "automation.enabled" : "automation.disabled",
    ip: await getIp(req),
  });

  return NextResponse.json({ automationEnabled: workspace.automationEnabled, paused: workspace.paused });
}