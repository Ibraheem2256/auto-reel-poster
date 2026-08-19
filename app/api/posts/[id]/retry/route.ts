import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, errorResponse, getIp } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  try {
    const post = await prisma.scheduledPost.findFirst({
      where: { id, workspaceId: auth.workspaceId },
      include: { jobs: true },
    });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const failedOrRetrying = post.jobs.filter((j) =>
      ["FAILED", "RETRYING"].includes(j.status) ||
      (j.status === "SUCCESS" && !j.platformPostId)
    );

    if (failedOrRetrying.length === 0) {
      return NextResponse.json({ message: "Nothing to retry — all jobs succeeded." });
    }

    const now = new Date();
    await prisma.platformJob.updateMany({
      where: { id: { in: failedOrRetrying.map((j) => j.id) } },
      data: {
        status: "PENDING",
        nextRetryAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    await prisma.video.update({
      where: { id: post.videoId },
      data: { status: "SCHEDULED", scheduledAt: now },
    });

    await audit({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      action: "post.retry_requested",
      entityType: "ScheduledPost",
      entityId: post.id,
      metadata: { jobIds: failedOrRetrying.map((j) => j.id) },
      ip: await getIp(req),
    });

    return NextResponse.json({ ok: true, retried: failedOrRetrying.map((j) => j.id) });
  } catch (err) {
    return errorResponse(err);
  }
}