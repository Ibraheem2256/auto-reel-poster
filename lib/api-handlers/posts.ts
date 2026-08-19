import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, errorResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const pageSize = Math.min(50, Math.max(1, Number(searchParams.get("pageSize") ?? 20)));

  try {
    const [posts, total] = await Promise.all([
      prisma.scheduledPost.findMany({
        where: { workspaceId: auth.workspaceId },
        include: {
          video: {
            select: { id: true, fileName: true, thumbnailUrl: true, driveFileId: true },
          },
          jobs: {
            select: {
              id: true,
              platform: true,
              status: true,
              platformPostId: true,
              platformPostUrl: true,
              errorCode: true,
              errorMessage: true,
              attemptCount: true,
              publishedAt: true,
              nextRetryAt: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { scheduledAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.scheduledPost.count({ where: { workspaceId: auth.workspaceId } }),
    ]);

    return NextResponse.json({ posts, total, page, pageSize });
  } catch (err) {
    return errorResponse(err);
  }
}
