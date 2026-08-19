import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, getIp } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { compare, hash } from "bcryptjs";
import { audit } from "@/lib/audit";
import { z } from "zod";

const passwordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Invalid data" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // If user already has a password set, verify current password
  if (user.passwordHash) {
    if (!parsed.data.currentPassword) {
      return NextResponse.json({ error: "Current password is required" }, { status: 400 });
    }
    const valid = await compare(parsed.data.currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Incorrect current password" }, { status: 400 });
    }
  }

  const newHash = await hash(parsed.data.newPassword, 12);
  await prisma.user.update({
    where: { id: auth.userId },
    data: { passwordHash: newHash },
  });

  await audit({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: "user.password_changed",
    ip: await getIp(req),
  });

  return NextResponse.json({ ok: true, message: "Password updated successfully" });
}
