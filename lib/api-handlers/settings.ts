import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, getIp } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { settingsSchema } from "@/lib/validation";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const [workspace, user] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: auth.workspaceId } }),
    prisma.user.findUnique({ where: { id: auth.userId } }),
  ]);
  if (!workspace) return NextResponse.json({ error: "No workspace" }, { status: 404 });
  return NextResponse.json({
    user: { email: user?.email, name: user?.name, image: user?.image },
    workspace: {
      id: workspace.id,
      name: workspace.name,
      timezone: workspace.timezone,
      queueOrder: workspace.queueOrder,
      captions: workspace.captions,
      hashtags: workspace.hashtags,
      titleMode: workspace.titleMode,
      customTitle: workspace.customTitle,
      aiEnabled: workspace.aiEnabled,
      aiSettings: workspace.aiSettings,
      autoEditEnabled: workspace.autoEditEnabled,
      automationEnabled: workspace.automationEnabled,
      paused: workspace.paused,
    },
    aiConfigured: Boolean(process.env.AI_API_KEY),
  });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Invalid settings" }, { status: 400 });
  }

  const data = parsed.data;
  if (data.name !== undefined) {
    await prisma.user.update({ where: { id: auth.userId }, data: { name: data.name } });
  }
  if (data.email !== undefined) {
    const normalizedEmail = data.email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing && existing.id !== auth.userId) {
      return NextResponse.json({ error: "This email is already registered to another account" }, { status: 400 });
    }
    await prisma.user.update({ where: { id: auth.userId }, data: { email: normalizedEmail } });
  }

  const workspaceUpdate: Record<string, unknown> = {};
  if (data.timezone !== undefined) workspaceUpdate.timezone = data.timezone;
  if (data.queueOrder !== undefined) workspaceUpdate.queueOrder = data.queueOrder;
  if (data.captions !== undefined) workspaceUpdate.captions = data.captions;
  if (data.hashtags !== undefined) workspaceUpdate.hashtags = data.hashtags;
  if (data.titleMode !== undefined) workspaceUpdate.titleMode = data.titleMode;
  if (data.customTitle !== undefined) workspaceUpdate.customTitle = data.customTitle;
  if (data.aiEnabled !== undefined) workspaceUpdate.aiEnabled = data.aiEnabled;
  if (data.aiSettings !== undefined) workspaceUpdate.aiSettings = data.aiSettings;
  if (data.autoEditEnabled !== undefined) workspaceUpdate.autoEditEnabled = data.autoEditEnabled;

  if (Object.keys(workspaceUpdate).length > 0) {
    await prisma.workspace.update({ where: { id: auth.workspaceId }, data: workspaceUpdate });
  }

  await audit({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: "settings.updated",
    metadata: { fields: Object.keys(workspaceUpdate) },
    ip: await getIp(req),
  });

  return NextResponse.json({ ok: true });
}
