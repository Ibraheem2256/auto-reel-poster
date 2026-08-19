import { type NextRequest, NextResponse } from "next/server";
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