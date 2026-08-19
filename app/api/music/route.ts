import { type NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "fs";
import { resolve } from "path";
import { requireAuth } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/music — list available CC0 music tracks. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { listMusicTrackNames } = await import("@/lib/editor");
  return NextResponse.json({ tracks: listMusicTrackNames() });
}

/** GET /api/music/[name] — stream a track for preview playback. */
export async function GET_Track(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { name } = await params;
  const safe = name.replace(/[^a-zA-Z0-9._ -]/g, "").slice(0, 120);
  const filePath = resolve(process.cwd(), "music", safe);
  try {
    const stat = statSync(filePath);
    if (!stat.isFile() || !/\.(mp3|m4a|wav|ogg)$/i.test(safe)) {
      return NextResponse.json({ error: "Track not found." }, { status: 404 });
    }
    return new Response(createReadStream(filePath) as never, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(stat.size),
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Track not found." }, { status: 404 });
  }
}