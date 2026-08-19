import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, checkRateLimit, getIp, errorResponse } from "@/lib/api";
import { folderLinkSchema, extractFolderId } from "@/lib/validation";
import { createOAuthState } from "@/lib/crypto";
import { getGoogleAuthUrl } from "@/lib/google";
import { audit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const rate = await checkRateLimit(req, "drive-connect", 10, 60);
  if (rate) return rate;

  const body = await req.json().catch(() => ({}));
  const parsed = folderLinkSchema.safeParse(body.folderLink ?? "");
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Invalid folder link" }, { status: 400 });
  }
  const folderId = extractFolderId(parsed.data);
  if (!folderId) {
    return NextResponse.json({ error: "Could not extract a folder ID from that link." }, { status: 400 });
  }

  const state = createOAuthState({
    type: "drive",
    workspaceId: auth.workspaceId,
    folderId,
  });
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/drive/callback`;
  let url: string;
  try {
    url = getGoogleAuthUrl({ scope: "DRIVE", state, redirectUri });
  } catch (err) {
    return errorResponse(err);
  }

  await audit({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: "drive.connect_initiated",
    metadata: { folderId },
    ip: await getIp(req),
  });

  return NextResponse.json({ url });
}