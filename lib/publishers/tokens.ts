import { prisma } from "@/lib/prisma";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import type { Platform, TokenScope } from "@prisma/client";

export const TOKEN_SCOPE_BY_PLATFORM: Record<Platform, TokenScope> = {
  YOUTUBE: "YOUTUBE",
  INSTAGRAM: "INSTAGRAM",
  FACEBOOK: "FACEBOOK",
  TIKTOK: "TIKTOK",
};

export async function getPlatformToken(
  workspaceId: string,
  platform: Platform
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date | null } | null> {
  const record = await prisma.oAuthToken.findFirst({
    where: { workspaceId, scope: TOKEN_SCOPE_BY_PLATFORM[platform] },
  });
  if (!record) return null;
  return {
    accessToken: decryptToken(record.accessToken),
    refreshToken: record.refreshToken ? decryptToken(record.refreshToken) : null,
    expiresAt: record.expiresAt,
  };
}

export async function savePlatformToken(
  workspaceId: string,
  platform: Platform,
  data: { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null; socialAccountId?: string }
): Promise<void> {
  await prisma.oAuthToken.upsert({
    where: { id: `${workspaceId}:${TOKEN_SCOPE_BY_PLATFORM[platform]}` },
    create: {
      id: `${workspaceId}:${TOKEN_SCOPE_BY_PLATFORM[platform]}`,
      workspaceId,
      scope: TOKEN_SCOPE_BY_PLATFORM[platform],
      accessToken: encryptToken(data.accessToken),
      refreshToken: data.refreshToken ? encryptToken(data.refreshToken) : null,
      expiresAt: data.expiresAt ?? null,
      socialAccountId: data.socialAccountId,
    },
    update: {
      accessToken: encryptToken(data.accessToken),
      refreshToken: data.refreshToken ? encryptToken(data.refreshToken) : null,
      expiresAt: data.expiresAt ?? null,
      socialAccountId: data.socialAccountId ?? undefined,
    },
  });
}

export async function upsertSocialAccount(opts: {
  workspaceId: string;
  platform: Platform;
  platformAccountId: string;
  accountName: string;
  avatarUrl?: string | null;
  scopes?: string | null;
  expiresAt?: Date | null;
}) {
  const account = await prisma.socialAccount.upsert({
    where: {
      workspaceId_platform_platformAccountId: {
        workspaceId: opts.workspaceId,
        platform: opts.platform,
        platformAccountId: opts.platformAccountId,
      },
    },
    create: {
      workspaceId: opts.workspaceId,
      platform: opts.platform,
      platformAccountId: opts.platformAccountId,
      accountName: opts.accountName,
      avatarUrl: opts.avatarUrl ?? null,
      scopes: opts.scopes ?? null,
      expiresAt: opts.expiresAt ?? null,
      status: "CONNECTED",
    },
    update: {
      accountName: opts.accountName,
      avatarUrl: opts.avatarUrl ?? undefined,
      scopes: opts.scopes ?? undefined,
      expiresAt: opts.expiresAt ?? null,
      status: "CONNECTED",
      lastError: null,
    },
  });
  return account;
}

export function markAccountError(workspaceId: string, platform: Platform, message: string) {
  return prisma.socialAccount.updateMany({
    where: { workspaceId, platform, status: "CONNECTED" },
    data: { status: "ERROR", lastError: message.slice(0, 1000) },
  });
}

export function markTokenExpired(workspaceId: string, platform: Platform, reason: string) {
  logger.warn("platform_token_expired", { workspaceId, platform, reason });
  return prisma.$transaction([
    prisma.oAuthToken.updateMany({
      where: { workspaceId, scope: TOKEN_SCOPE_BY_PLATFORM[platform] },
      data: { expiresAt: new Date(0) },
    }),
    prisma.socialAccount.updateMany({
      where: { workspaceId, platform, status: "CONNECTED" },
      data: { status: "EXPIRED", lastError: reason },
    }),
  ]);
}