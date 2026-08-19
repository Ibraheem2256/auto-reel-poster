import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, errorResponse } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { buildContentFor, splitHashtagBlock } from "@/lib/content";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  try {
    const video = await prisma.video.findFirst({ where: { id, workspaceId: auth.workspaceId } });
    if (!video) return NextResponse.json({ error: "Video not found." }, { status: 404 });
    const workspace = await prisma.workspace.findUnique({ where: { id: auth.workspaceId } });
    if (!workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });

    const content = await buildContentFor({ video, workspace, platform: "YOUTUBE" });
    const { text, hashtags } = splitHashtagBlock(content.caption);

    return NextResponse.json({
      title: content.title,
      caption: text,
      hashtags,
      description: content.description,
      aiGenerated: content.aiGenerated,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
