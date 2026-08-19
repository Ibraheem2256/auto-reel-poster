import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getPublisher } from "@/lib/publishers/index";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const accounts = await prisma.socialAccount.findMany({
    where: { workspaceId: auth.workspaceId },
    orderBy: { createdAt: "asc" },
  });

  const results = await Promise.all(
    accounts.map(async (account) => {
      const publisher = getPublisher(account.platform);
      const check = await publisher.validateAccount(auth.workspaceId);
      return {
        id: account.id,
        platform: account.platform,
        accountName: account.accountName,
        avatarUrl: account.avatarUrl,
        status: check.ok ? "CONNECTED" : "ERROR",
        error: check.error ?? account.lastError,
      };
    })
  );

  return NextResponse.json({ accounts: results });
}
