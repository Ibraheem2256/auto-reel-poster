import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { normalizeEditSpec, type EditSpec } from "@/lib/editor-spec";
import { listMusicTrackNames } from "@/lib/editor";
import { bgRemovalAvailable } from "@/lib/bg-removal";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const video = await prisma.video.findFirst({ where: { id, workspaceId: auth.workspaceId } });
  if (!video) {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  const spec = video.editSpec ? normalizeEditSpec(video.editSpec) : null;

  return NextResponse.json({
    video: {
      id: video.id,
      fileName: video.fileName,
      title: video.title,
      durationMs: video.durationMs,
      width: video.width,
      height: video.height,
      status: video.status,
      thumbnailUrl: video.thumbnailUrl,
    },
    editSpec: spec,
    music: listMusicTrackNames(),
    bgRemovalAvailable: bgRemovalAvailable(),
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const video = await prisma.video.findFirst({ where: { id, workspaceId: auth.workspaceId } });
  if (!video) {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid edit spec." }, { status: 400 });
  }

  const spec = normalizeEditSpec(body);
  const editSpec: EditSpec = { ...spec, updatedAt: new Date().toISOString() };

  await prisma.video.update({
    where: { id: video.id },
    data: { editSpec: editSpec as never },
  });

  return NextResponse.json({ ok: true, editSpec });
}
