import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, errorResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { PLATFORM_LABELS } from "@/lib/constants";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  try {
    const post = await prisma.scheduledPost.findFirst({
      where: { id, workspaceId: auth.workspaceId },
      include: {
        video: {
          include: { driveSource: { select: { folderName: true, folderId: true } } },
        },
        schedule: { select: { name: true } },
        jobs: {
          include: {
            socialAccount: { select: { accountName: true, platform: true } },
            platformPosts: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const timeline = await prisma.auditLog.findMany({
      where: { workspaceId: auth.workspaceId, entityType: "PlatformJob", entityId: { in: post.jobs.map((j) => j.id) } },
      orderBy: { createdAt: "asc" },
      take: 50,
    });

    return NextResponse.json({
      post,
      timeline,
      platformLabels: PLATFORM_LABELS,
      driveFolder: post.video.driveSource?.folderName,
    });
  } catch (err) {
    return errorResponse(err);
  }
}