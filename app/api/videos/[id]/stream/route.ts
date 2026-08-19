import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getDriveClient } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/videos/[id]/stream — proxies the Drive video with Range support so
 * the editor preview player can seek. Streams directly from Drive; nothing is
 * stored.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const video = await prisma.video.findFirst({ where: { id, workspaceId: auth.workspaceId } });
  if (!video) {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  try {
    const drive = await getDriveClient(auth.workspaceId);
    const range = req.headers.get("range");
    const headers: Record<string, string> = {};
    if (range) headers.Range = range;

    const res = await drive.files.get(
      { fileId: video.driveFileId, alt: "media" },
      { responseType: "stream", headers }
    );

    const responseHeaders = new Headers();
    responseHeaders.set("Content-Type", res.headers["content-type"] ?? video.mimeType ?? "video/mp4");
    responseHeaders.set("Accept-Ranges", "bytes");
    if (res.headers["content-range"]) responseHeaders.set("Content-Range", res.headers["content-range"]);
    if (res.headers["content-length"]) responseHeaders.set("Content-Length", res.headers["content-length"]);
    responseHeaders.set("Cache-Control", "private, no-store");

    return new Response(res.data as unknown as BodyInit, {
      status: range ? 206 : 200,
      headers: responseHeaders,
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to stream video." }, { status: 502 });
  }
}