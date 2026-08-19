import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { markNotificationsRead } from "@/lib/notify";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const notifications = await prisma.notification.findMany({
    where: { workspaceId: auth.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const unread = await prisma.notification.count({
    where: { workspaceId: auth.workspaceId, read: false },
  });
  return NextResponse.json({ notifications, unread });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({}));
  await markNotificationsRead(auth.workspaceId, body.ids as string[] | undefined);
  return NextResponse.json({ ok: true });
}