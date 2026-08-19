import { NextResponse, type NextRequest } from "next/server";
import { hash } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createDefaultWorkspace } from "@/lib/workspace";
import { audit } from "@/lib/audit";
import { checkRateLimit, getIp } from "@/lib/api";
import { logger } from "@/lib/logger";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
  name: z.string().min(1).max(100).optional(),
});

export async function POST(req: NextRequest) {
  const rate = await checkRateLimit(req, "register", 5, 600);
  if (rate) return rate;

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const email = parsed.data.email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  const passwordHash = await hash(parsed.data.password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name ?? email.split("@")[0],
      passwordHash,
      emailVerified: new Date(),
    },
  });
  await createDefaultWorkspace(user.id);
  await audit({ userId: user.id, action: "user.register", ip: await getIp(req) });
  logger.info("user_registered", { userId: user.id });

  return NextResponse.json({ ok: true }, { status: 201 });
}