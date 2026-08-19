import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyOAuthState, encryptToken } from "@/lib/crypto";
import { exchangeGoogleCode, getYouTubeClient } from "@/lib/google";
import { exchangeMetaCode, getLongLivedToken, getPageToken, saveMetaToken } from "@/lib/publishers/meta";
import { exchangeTikTokCode } from "@/lib/publishers/tiktok";
import { upsertSocialAccount, savePlatformToken } from "@/lib/publishers/tokens";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import type { Platform } from "@prisma/client";

const REDIRECT_TO = "accounts";
const bad = (msg: string) =>
  NextResponse.redirect(`${process.env.NEXTAUTH_URL}/${REDIRECT_TO}?error=${encodeURIComponent(msg)}`);

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const { platform: platformRaw } = await params;
  const platform = platformRaw as "youtube" | "instagram" | "facebook" | "tiktok";

  if (error || !code || !state) return bad("Authorization was cancelled or failed.");
  const payload = verifyOAuthState(state);
  if (!payload || payload.type !== platform || !payload.workspaceId) {
    return bad("Invalid OAuth state. Please try again.");
  }
  const workspaceId = payload.workspaceId;
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/social/${platform}/callback`;

  try {
    if (platform === "youtube") {
      await handleYouTube(workspaceId, code, redirectUri);
    } else if (platform === "instagram" || platform === "facebook") {
      await handleMeta(workspaceId, code, redirectUri, platform === "instagram" ? "INSTAGRAM" : "FACEBOOK");
    } else if (platform === "tiktok") {
      await handleTikTok(workspaceId, code, redirectUri);
    } else {
      return bad("Unknown platform.");
    }
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/${REDIRECT_TO}?connected=${platform}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`${platform}_callback_failed`, { workspaceId, error: message });
    return bad(message.slice(0, 300));
  }
}

async function handleYouTube(workspaceId: string, code: string, redirectUri: string) {
  const tokens = await exchangeGoogleCode(code, redirectUri);
  if (!tokens.refreshToken) {
    throw new Error("Google did not return a refresh token. Reconnect and approve the requested permissions.");
  }
  await prisma.oAuthToken.upsert({
    where: { id: `${workspaceId}:YOUTUBE` },
    create: {
      id: `${workspaceId}:YOUTUBE`,
      workspaceId,
      scope: "YOUTUBE",
      accessToken: encryptToken(tokens.accessToken),
      refreshToken: encryptToken(tokens.refreshToken),
      expiresAt: tokens.expiresAt,
    },
    update: {
      accessToken: encryptToken(tokens.accessToken),
      refreshToken: encryptToken(tokens.refreshToken),
      expiresAt: tokens.expiresAt,
    },
  });

  const youtube = await getYouTubeClient(workspaceId);
  const res = await youtube.channels.list({ part: ["snippet"], mine: true });
  const channel = res.data.items?.[0];
  if (!channel?.id) {
    await prisma.oAuthToken.deleteMany({ where: { workspaceId, scope: "YOUTUBE" } });
    throw new Error("No YouTube channel found on this account.");
  }
  const account = await upsertSocialAccount({
    workspaceId,
    platform: "YOUTUBE",
    platformAccountId: channel.id,
    accountName: channel.snippet?.title ?? "YouTube channel",
    avatarUrl: channel.snippet?.thumbnails?.default?.url ?? null,
    scopes: "youtube.upload youtube.readonly",
    expiresAt: tokens.expiresAt,
  });
  await audit({
    workspaceId,
    action: "social.youtube_connected",
    entityType: "SocialAccount",
    entityId: account.id,
    metadata: { channelId: channel.id },
  });
}

async function handleMeta(
  workspaceId: string,
  code: string,
  redirectUri: string,
  platform: Extract<Platform, "INSTAGRAM" | "FACEBOOK">
) {
  const { accessToken: shortToken } = await exchangeMetaCode(code, redirectUri);
  const longToken = await getLongLivedToken(shortToken);

  const pagesRes = await fetch(
    `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,picture,access_token&access_token=${encodeURIComponent(longToken)}`
  );
  const pagesData = (await pagesRes.json().catch(() => ({}))) as {
    data?: { id: string; name: string; picture?: { data?: { url?: string } }; access_token?: string }[];
    error?: { message?: string };
  };
  if (!pagesRes.ok || !pagesData.data?.length) {
    throw new Error(pagesData.error?.message ?? "No Facebook Pages found that this app can manage.");
  }

  if (platform === "INSTAGRAM") {
    for (const page of pagesData.data) {
      const pageInfo = (await fetch(
        `https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account{id,username,name}&access_token=${encodeURIComponent(page.access_token ?? longToken)}`
      ).then((r) => r.json())) as { instagram_business_account?: { id: string; username?: string; name?: string } };
      const ig = pageInfo.instagram_business_account;
      if (ig?.id) {
        const pageToken = await getPageToken(longToken, page.id);
        const account = await upsertSocialAccount({
          workspaceId,
          platform: "INSTAGRAM",
          platformAccountId: ig.id,
          accountName: ig.name ?? ig.username ?? "Instagram account",
          scopes: "instagram_basic instagram_content_publish pages_show_list",
        });
        await saveMetaToken(workspaceId, "INSTAGRAM", pageToken, account.id);
        await audit({
          workspaceId,
          action: "social.instagram_connected",
          entityType: "SocialAccount",
          entityId: account.id,
          metadata: { igId: ig.id, pageId: page.id },
        });
        logger.info("instagram_connected", { workspaceId, igId: ig.id });
        return;
      }
    }
    throw new Error(
      "Instagram cannot be connected for automatic publishing. Reason: Account/API permission requirements are not satisfied. The Instagram account must be a Business/Creator account linked to a Facebook Page."
    );
  }

  const page = pagesData.data[0];
  const pageToken = page.access_token ?? (await getPageToken(longToken, page.id));
  const account = await upsertSocialAccount({
    workspaceId,
    platform: "FACEBOOK",
    platformAccountId: page.id,
    accountName: page.name,
    avatarUrl: page.picture?.data?.url ?? null,
    scopes: "pages_show_list pages_manage_posts pages_read_engagement",
  });
  await saveMetaToken(workspaceId, "FACEBOOK", pageToken, account.id);
  await audit({
    workspaceId,
    action: "social.facebook_connected",
    entityType: "SocialAccount",
    entityId: account.id,
    metadata: { pageId: page.id, pages: pagesData.data.map((p) => p.name) },
  });
  logger.info("facebook_connected", { workspaceId, pageId: page.id });
}

async function handleTikTok(workspaceId: string, code: string, redirectUri: string) {
  const tokens = await exchangeTikTokCode(code, redirectUri);
  await savePlatformToken(workspaceId, "TIKTOK", {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
  });

  const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name", {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  const user = (data as { data?: { user?: { open_id?: string; display_name?: string; avatar_url?: string } } }).data?.user;
  if (!res.ok || !user?.open_id) {
    await prisma.oAuthToken.deleteMany({ where: { workspaceId, scope: "TIKTOK" } });
    throw new Error("Could not verify the TikTok account. Make sure the app has the video.publish permission.");
  }
  const account = await upsertSocialAccount({
    workspaceId,
    platform: "TIKTOK",
    platformAccountId: user.open_id,
    accountName: user.display_name ?? "TikTok account",
    avatarUrl: user.avatar_url ?? null,
    scopes: "user.info.basic video.publish",
  });
  await audit({
    workspaceId,
    action: "social.tiktok_connected",
    entityType: "SocialAccount",
    entityId: account.id,
    metadata: { openId: user.open_id },
  });
  logger.info("tiktok_connected", { workspaceId, openId: user.open_id });
}
