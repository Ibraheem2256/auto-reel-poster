import { google, type drive_v3, type youtube_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/logger";
import type { TokenScope } from "@prisma/client";

export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];
export const LOGIN_SCOPES = ["openid", "email", "profile"];

export const GOOGLE_OAUTH_URLS = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
};

function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new AppError("GOOGLE_NOT_CONFIGURED", "Google OAuth is not configured on the server.", {
      status: 503,
    });
  }
  return { clientId, clientSecret };
}

export function getGoogleAuthUrl(opts: {
  scope: TokenScope;
  state: string;
  redirectUri: string;
}): string {
  const { clientId } = getGoogleOAuthConfig();
  const scopes = opts.scope === "DRIVE" ? DRIVE_SCOPES : YOUTUBE_SCOPES;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: [...LOGIN_SCOPES, ...scopes].join(" "),
    access_type: "offline",
    prompt: "consent",
    state: opts.state,
    include_granted_scopes: "true",
  });
  return `${GOOGLE_OAUTH_URLS.auth}?${params.toString()}`;
}

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date | null }> {
  const { clientId, clientSecret } = getGoogleOAuthConfig();
  const res = await fetch(GOOGLE_OAUTH_URLS.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    logger.error("google_token_exchange_failed", { status: res.status, error: data.error });
    throw new AppError("GOOGLE_TOKEN_EXCHANGE_FAILED", "Google authorization failed. Please try again.", {
      status: 502,
    });
  }
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string) ?? null,
    expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000) : null,
  };
}

export async function refreshGoogleToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const { clientId, clientSecret } = getGoogleOAuthConfig();
  const res = await fetch(GOOGLE_OAUTH_URLS.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    logger.error("google_token_refresh_failed", { status: res.status, error: data.error });
    throw new AppError("GOOGLE_TOKEN_REFRESH_FAILED", "Google token refresh failed.", { retryable: true });
  }
  return {
    accessToken: data.access_token as string,
    expiresAt: new Date(Date.now() + Number(data.expires_in ?? 3600) * 1000),
  };
}

async function getTokenRecord(workspaceId: string, scope: TokenScope) {
  return prisma.oAuthToken.findFirst({ where: { workspaceId, scope } });
}

async function getValidAccessToken(workspaceId: string, scope: TokenScope): Promise<string> {
  const record = await getTokenRecord(workspaceId, scope);
  if (!record) {
    throw new AppError("TOKEN_NOT_FOUND", `No ${scope} connection found. Connect it first.`, { status: 401 });
  }
  const accessToken = decryptToken(record.accessToken);
  if (record.expiresAt && record.expiresAt.getTime() - 60_000 < Date.now()) {
    if (!record.refreshToken) {
      throw new AppError("TOKEN_EXPIRED", `${scope} authorization has expired. Reconnect to continue.`, {
        status: 401,
      });
    }
    const refreshed = await refreshGoogleToken(decryptToken(record.refreshToken));
    await prisma.oAuthToken.update({
      where: { id: record.id },
      data: { accessToken: encryptToken(refreshed.accessToken), expiresAt: refreshed.expiresAt },
    });
    return refreshed.accessToken;
  }
  return accessToken;
}

export async function getDriveClient(workspaceId: string): Promise<drive_v3.Drive> {
  const token = await getValidAccessToken(workspaceId, "DRIVE");
  const oauth = new google.auth.OAuth2({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  });
  oauth.setCredentials({ access_token: token });
  return google.drive({ version: "v3", auth: oauth });
}

export async function getYouTubeClient(workspaceId: string): Promise<youtube_v3.Youtube> {
  const token = await getValidAccessToken(workspaceId, "YOUTUBE");
  const oauth = new google.auth.OAuth2({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  });
  oauth.setCredentials({ access_token: token });
  return google.youtube({ version: "v3", auth: oauth });
}

export { getValidAccessToken };

export async function getDriveTokenExpiry(workspaceId: string): Promise<Date | null> {
  const record = await getTokenRecord(workspaceId, "DRIVE");
  return record?.expiresAt ?? null;
}