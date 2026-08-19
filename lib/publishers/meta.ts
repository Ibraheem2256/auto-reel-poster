import { prisma } from "@/lib/prisma";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { PublisherError } from "@/lib/publishers/types";
import type { Platform } from "@prisma/client";

const GRAPH = "https://graph.facebook.com";

export const META_SCOPES = {
  INSTAGRAM: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement"],
  FACEBOOK: ["pages_show_list", "pages_manage_posts", "pages_read_engagement"],
} as const;

function getMetaConfig() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new PublisherError("META_NOT_CONFIGURED", "Meta app is not configured on the server.");
  }
  return { appId, appSecret };
}

export function getMetaAuthUrl(opts: { scopes: string[]; state: string; redirectUri: string; nonce: string }): string {
  const { appId } = getMetaConfig();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    scope: opts.scopes.join(","),
    response_type: "code",
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

export async function exchangeMetaCode(code: string, redirectUri: string): Promise<{ accessToken: string }> {
  const { appId, appSecret } = getMetaConfig();
  const res = await fetch(
    `${GRAPH}/v21.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    logger.error("meta_token_exchange_failed", { status: res.status, error: data.error });
    throw new PublisherError("META_AUTH_FAILED", "Meta authorization failed. Please try again.", { retryable: true });
  }
  return { accessToken: data.access_token as string };
}

export async function getLongLivedToken(shortToken: string): Promise<string> {
  const { appId, appSecret } = getMetaConfig();
  const res = await fetch(
    `${GRAPH}/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(shortToken)}`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new PublisherError("META_LONG_TOKEN_FAILED", "Could not exchange Meta token.", { retryable: true });
  return data.access_token as string;
}

export async function getPageToken(userToken: string, pageId: string): Promise<string> {
  const res = await fetch(
    `${GRAPH}/${pageId}?fields=access_token,name,picture&access_token=${encodeURIComponent(userToken)}`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new PublisherError("META_PAGE_TOKEN_FAILED", data.error?.message ?? "Could not get page token.", { retryable: true });
  }
  return data.access_token as string;
}

export async function extendPageToken(pageToken: string): Promise<string> {
  const { appId, appSecret } = getMetaConfig();
  const res = await fetch(
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(pageToken)}`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new PublisherError("META_PAGE_LONG_TOKEN_FAILED", "Could not extend page token.", { retryable: true });
  return data.access_token as string;
}

export async function getMetaToken(workspaceId: string, platform: Extract<Platform, "INSTAGRAM" | "FACEBOOK">) {
  const record = await prisma.oAuthToken.findFirst({ where: { workspaceId, scope: platform } });
  if (!record) return null;
  return {
    accessToken: decryptToken(record.accessToken),
    expiresAt: record.expiresAt,
  };
}

export async function saveMetaToken(
  workspaceId: string,
  platform: Extract<Platform, "INSTAGRAM" | "FACEBOOK">,
  accessToken: string,
  socialAccountId: string
) {
  await prisma.oAuthToken.upsert({
    where: { id: `${workspaceId}:${platform}` },
    create: {
      id: `${workspaceId}:${platform}`,
      workspaceId,
      scope: platform,
      accessToken: encryptToken(accessToken),
      expiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000), // ~60 days
      socialAccountId,
    },
    update: {
      accessToken: encryptToken(accessToken),
      expiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000),
      socialAccountId,
    },
  });
}

export async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${GRAPH}${path}${qs ? `?${qs}` : ""}`);
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || (data as { error?: unknown }).error) {
    const err = (data as { error?: { message?: string; code?: number } }).error;
    throw new PublisherError(
      `META_${err?.code ?? res.status}`,
      err?.message ?? `Meta API error (${res.status})`,
      { retryable: res.status >= 500 }
    );
  }
  return data;
}

export async function graphPostFormData(
  path: string,
  body: unknown,
  contentType: string
): Promise<{ id?: string; error?: { message?: string; code?: number } }> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    headers: { "content-type": contentType },
    body: body as BodyInit,
    // @ts-expect-error Node fetch accepts streaming bodies with duplex
    duplex: "half",
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string; code?: number } };
  if (!res.ok || data.error) {
    throw new PublisherError(
      `META_${data.error?.code ?? res.status}`,
      data.error?.message ?? `Meta API error (${res.status})`,
      { retryable: res.status >= 500 || [190, 1, 2, 4].includes(data.error?.code ?? 0) }
    );
  }
  return data;
}

export async function graphPostJson(path: string, body: Record<string, unknown>): Promise<{ id?: string; error?: { message?: string; code?: number } }> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string; code?: number } };
  if (!res.ok || data.error) {
    throw new PublisherError(
      `META_${data.error?.code ?? res.status}`,
      data.error?.message ?? `Meta API error (${res.status})`,
      { retryable: res.status >= 500 || [190, 1, 2, 4].includes(data.error?.code ?? 0) }
    );
  }
  return data;
}