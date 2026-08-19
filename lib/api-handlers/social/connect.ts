import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, checkRateLimit, getIp, errorResponse } from "@/lib/api";
import { createOAuthState } from "@/lib/crypto";
import { getGoogleAuthUrl } from "@/lib/google";
import { getMetaAuthUrl, META_SCOPES } from "@/lib/publishers/meta";
import { getTikTokAuthUrl } from "@/lib/publishers/tiktok";
import { audit } from "@/lib/audit";

const VALID = ["youtube", "instagram", "facebook", "tiktok"] as const;
type PlatformSlug = (typeof VALID)[number];

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { platform: platformRaw } = await params;
  const platform = platformRaw as PlatformSlug;
  if (!VALID.includes(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }

  try {
    const nonce = Math.random().toString(36).slice(2);
    const state = createOAuthState({ type: platform, workspaceId: auth.workspaceId, nonce });
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/social/${platform}/callback`;
    let url: string;

    if (platform === "youtube") {
      url = getGoogleAuthUrl({ scope: "YOUTUBE", state, redirectUri });
    } else if (platform === "tiktok") {
      url = getTikTokAuthUrl({ state, redirectUri, csrfState: nonce });
    } else {
      const scopes = platform === "instagram" ? META_SCOPES.INSTAGRAM : META_SCOPES.FACEBOOK;
      url = getMetaAuthUrl({ scopes: [...scopes], state, redirectUri, nonce });
    }

    await audit({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      action: `social.${platform}.connect_initiated`,
      ip: await getIp(req),
    });

    return NextResponse.json({ url });
  } catch (err) {
    return errorResponse(err);
  }
}
