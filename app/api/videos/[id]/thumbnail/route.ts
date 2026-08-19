import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getDriveClient, getValidAccessToken } from "@/lib/google";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/utils";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — Drive thumbnails rarely change
const MAX_CACHE_ENTRIES = 500;

interface CacheEntry {
  bytes: Buffer;
  type: string;
  fetchedAt: number;
}

// In-memory thumbnail cache (serverless-friendly: each lambda has its own).
const cache = new Map<string, CacheEntry>();

const PLACEHOLDER = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="100%" height="100%" fill="#f1f5f9"/><text x="50%" y="50%" font-family="system-ui,sans-serif" font-size="22" fill="#94a3b8" text-anchor="middle" dominant-baseline="middle">VID</text></svg>`
);

function placeholderResponse() {
  return new NextResponse(PLACEHOLDER, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "private, max-age=86400",
    },
  });
}

function setCached(key: string, entry: CacheEntry) {
  cache.set(key, entry);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  try {
    const video = await prisma.video.findFirst({
      where: { id, workspaceId: auth.workspaceId },
      select: { driveFileId: true, modifiedTime: true },
    });
    if (!video?.driveFileId) return placeholderResponse();

    const cacheKey = `${video.driveFileId}:${video.modifiedTime?.getTime() ?? 0}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
      return new NextResponse(new Uint8Array(hit.bytes), {
        headers: {
          "Content-Type": hit.type,
          "Cache-Control": "private, max-age=86400",
        },
      });
    }

    // Fetch a fresh thumbnail link and stream it with the user's Drive token.
    const token = await getValidAccessToken(auth.workspaceId, "DRIVE");
    const drive = await getDriveClient(auth.workspaceId);
    const res = await drive.files.get({
      fileId: video.driveFileId,
      fields: "thumbnailLink",
    });
    const thumbLink = res.data.thumbnailLink;
    if (!thumbLink) return placeholderResponse();

    const imgRes = await fetch(thumbLink, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!imgRes.ok) return placeholderResponse();

    const bytes = Buffer.from(await imgRes.arrayBuffer());
    const type = imgRes.headers.get("content-type") ?? "image/jpeg";
    setCached(cacheKey, { bytes, type, fetchedAt: Date.now() });

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (err) {
    logger.warn("thumbnail_proxy_failed", { videoId: id, error: getErrorMessage(err).slice(0, 200) });
    return placeholderResponse();
  }
}
