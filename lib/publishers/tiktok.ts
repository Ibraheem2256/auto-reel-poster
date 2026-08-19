import { prisma } from "@/lib/prisma";
import { streamVideoFromDrive } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { upsertSocialAccount, markTokenExpired, savePlatformToken, getPlatformToken } from "@/lib/publishers/tokens";
import { PublisherError, type PublishContext, type PublishResult, type SocialPublisher } from "@/lib/publishers/types";
import type { Platform } from "@prisma/client";

const BASE = "https://open.tiktokapis.com/v2";
const TIKTOK_SCOPES = ["user.info.basic", "video.publish"];

export function getTikTokAuthUrl(opts: { state: string; redirectUri: string; csrfState: string }): string {
  const key = process.env.TIKTOK_CLIENT_KEY;
  if (!key) throw new PublisherError("TIKTOK_NOT_CONFIGURED", "TikTok developer app is not configured on the server.");
  const params = new URLSearchParams({
    client_key: key,
    response_type: "code",
    scope: TIKTOK_SCOPES.join(","),
    redirect_uri: opts.redirectUri,
    state: opts.state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

export async function exchangeTikTokCode(code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const key = process.env.TIKTOK_CLIENT_KEY;
  const secret = process.env.TIKTOK_CLIENT_SECRET;
  if (!key || !secret) throw new PublisherError("TIKTOK_NOT_CONFIGURED", "TikTok developer app is not configured.");
  const res = await fetch(`${BASE}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: key,
      client_secret: secret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    logger.error("tiktok_token_exchange_failed", { status: res.status, error: data.error });
    throw new PublisherError("TIKTOK_AUTH_FAILED", "TikTok authorization failed. Please try again.", { retryable: true });
  }
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresIn: Number(data.expires_in ?? 86400),
  };
}

export async function refreshTikTokToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const key = process.env.TIKTOK_CLIENT_KEY;
  const secret = process.env.TIKTOK_CLIENT_SECRET;
  if (!key || !secret) throw new PublisherError("TIKTOK_NOT_CONFIGURED", "TikTok developer app is not configured.");
  const res = await fetch(`${BASE}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: key,
      client_secret: secret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    logger.error("tiktok_token_refresh_failed", { status: res.status, error: data.error });
    throw new PublisherError("TIKTOK_REFRESH_FAILED", "TikTok token refresh failed.", { retryable: true });
  }
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string) ?? refreshToken,
    expiresIn: Number(data.expires_in ?? 86400),
  };
}

async function getAccessToken(workspaceId: string): Promise<string> {
  const token = await getPlatformToken(workspaceId, "TIKTOK");
  if (!token) throw new PublisherError("NOT_CONNECTED", "TikTok is not connected.", { retryable: false });
  const expired = token.expiresAt && token.expiresAt.getTime() < Date.now();
  if (expired) {
    if (!token.refreshToken) {
      markTokenExpired(workspaceId, "TIKTOK", "TikTok token expired and no refresh token is available.");
      throw new PublisherError("TOKEN_EXPIRED", "TikTok authorization expired. Reconnect to continue.", { retryable: false });
    }
    try {
      const refreshed = await refreshTikTokToken(token.refreshToken);
      await savePlatformToken(workspaceId, "TIKTOK", {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
      });
      return refreshed.accessToken;
    } catch (err) {
      markTokenExpired(workspaceId, "TIKTOK", "TikTok token refresh failed.");
      throw err;
    }
  }
  return token.accessToken;
}

// --- CRC32 (needed for chunk upload verification) ---
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer | Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export class TikTokPublisher implements SocialPublisher {
  readonly platform: Platform = "TIKTOK";

  async validateAccount(workspaceId: string) {
    try {
      const accessToken = await getAccessToken(workspaceId);
      const res = await fetch(`${BASE}/user/info/?fields=open_id,union_id,avatar_url,display_name`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json().catch(() => ({}));
      const user = (data as { data?: { user?: { open_id?: string; display_name?: string; avatar_url?: string } } }).data?.user;
      if (!res.ok || !user?.open_id) {
        const msg = (data as { error?: { message?: string } }).error?.message ?? "TikTok account validation failed.";
        if (res.status === 401) markTokenExpired(workspaceId, "TIKTOK", msg);
        return { ok: false, error: msg };
      }
      await upsertSocialAccount({
        workspaceId,
        platform: "TIKTOK",
        platformAccountId: user.open_id,
        accountName: user.display_name ?? "TikTok account",
        avatarUrl: user.avatar_url ?? null,
        scopes: TIKTOK_SCOPES.join(","),
      });
      return { ok: true, accountName: user.display_name ?? "TikTok account" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : String(err) };
    }
  }

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const accessToken = await getAccessToken(ctx.workspace.id);
    const { video, caption, title } = ctx;
    const { statSync } = await import("fs");
    const videoSize = ctx.videoFilePath ? statSync(ctx.videoFilePath).size : Number(video.fileSize ?? 0);
    if (!videoSize) throw new PublisherError("NO_FILE_SIZE", "TikTok requires the file size for upload.", { retryable: false });

    const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB
    const totalChunkCount = Math.ceil(videoSize / CHUNK_SIZE);
    const privacy = (process.env.TIKTOK_PRIVACY_LEVEL ?? "SELF_ONLY") as string;

    // 1. Initialize
    const initRes = await fetch(`${BASE}/post/publish/video/init/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        post_info: {
          title: (title || caption).slice(0, 2200),
          privacy_level: privacy,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: videoSize,
          chunk_size: CHUNK_SIZE,
          total_chunk_count: totalChunkCount,
        },
      }),
    });
    const initData = await initRes.json().catch(() => ({}));
    const publishId = (initData as { data?: { publish_id?: string; upload_url?: string } }).data?.publish_id;
    const uploadUrl = (initData as { data?: { upload_url?: string } }).data?.upload_url;
    if (!initRes.ok || !publishId || !uploadUrl) {
      throw new PublisherError(
        "TIKTOK_INIT_FAILED",
        (initData as { error?: { message?: string } }).error?.message ?? "TikTok upload initialization failed.",
        { retryable: initRes.status >= 500 }
      );
    }

    // 2. Chunked upload from a streaming read of the Drive file
    const stream = ctx.videoFilePath
      ? (await import("fs")).createReadStream(ctx.videoFilePath)
      : await streamVideoFromDrive(ctx.workspace.id, video.driveFileId);
    const chunks: Buffer[] = [];
    const CHUNK_BUFFER = CHUNK_SIZE;
    let buffered = 0;
    let current: Buffer = Buffer.alloc(0);
    let chunkNumber = 0;

    try {
      for await (const raw of stream as unknown as AsyncIterable<Buffer>) {
        current = current.length ? Buffer.concat([current, raw]) : raw;
        while (current.length >= CHUNK_BUFFER) {
          chunks.push(current.subarray(0, CHUNK_BUFFER));
          current = current.subarray(CHUNK_BUFFER);
          buffered += CHUNK_BUFFER;
        }
        if (chunks.length >= 2 || buffered >= CHUNK_BUFFER) {
          while (chunks.length) await this.uploadChunk(uploadUrl, publishId, chunkNumber++, chunks.shift()!);
          buffered = 0;
        }
      }
      if (current.length) chunks.push(current);
      while (chunks.length) await this.uploadChunk(uploadUrl, publishId, chunkNumber++, chunks.shift()!);
      if (chunkNumber !== totalChunkCount) {
        throw new PublisherError("TIKTOK_CHUNK_MISMATCH", `Uploaded ${chunkNumber} of ${totalChunkCount} chunks.`, { retryable: true });
      }

      // 3. Complete
      const completeRes = await fetch(`${BASE}/post/publish/video/complete/?publish_id=${publishId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const completeData = await completeRes.json().catch(() => ({}));
      const status = (completeData as { data?: { status?: string } }).data?.status;
      if (!completeRes.ok || status !== "PUBLISH_COMPLETE") {
        throw new PublisherError(
          "TIKTOK_COMPLETE_FAILED",
          (completeData as { error?: { message?: string } }).error?.message ?? `TikTok returned status ${status ?? "unknown"}.`,
          { retryable: completeRes.status >= 500 }
        );
      }

      await prisma.platformPost.create({
        data: {
          platformJobId: ctx.job.id,
          videoId: video.id,
          platform: "TIKTOK",
          platformPostId: publishId,
          platformPostUrl: `https://www.tiktok.com/@me/video/${publishId}`,
        },
      });
      return { postId: publishId, postUrl: `https://www.tiktok.com/@me/video/${publishId}` };
    } finally {
      // Release memory; no temp file was persisted.
    }
  }

  private async uploadChunk(uploadUrl: string, publishId: string, chunkNumber: number, chunk: Buffer) {
    const res = await fetch(`${uploadUrl}?upload_id=${publishId}&chunk_number=${chunkNumber}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Content-Length": String(chunk.length),
        "X-Content-Crc32": String(crc32(chunk)),
        "X-Timestamp": String(Math.floor(Date.now() / 1000)),
      },
      body: new Uint8Array(chunk),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new PublisherError("TIKTOK_CHUNK_FAILED", `TikTok rejected chunk ${chunkNumber} (${res.status}).`, {
        retryable: res.status >= 500,
        raw: body.slice(0, 500),
      });
    }
  }

  async checkStatus(workspaceId: string, postId: string, videoId?: string) {
    try {
      const accessToken = await getAccessToken(workspaceId);
      const res = await fetch(`${BASE}/post/publish/status/fetch/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ publish_id: postId }),
      });
      const data = await res.json().catch(() => ({}));
      const status = (data as { data?: { status?: string } }).data?.status;
      if (status === "PUBLISH_COMPLETE") return { status: "published" as const };
      if (status === "FAILED") return { status: "failed" as const };
      return { status: "pending" as const };
    } catch {
      return { status: "pending" as const };
    }
  }

  async refreshToken(workspaceId: string): Promise<boolean> {
    const token = await getPlatformToken(workspaceId, "TIKTOK");
    if (!token) return false;
    if (!token.refreshToken) return false;
    try {
      const refreshed = await refreshTikTokToken(token.refreshToken);
      await savePlatformToken(workspaceId, "TIKTOK", {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
      });
      await prisma.socialAccount.updateMany({
        where: { workspaceId, platform: "TIKTOK" },
        data: { status: "CONNECTED", lastError: null },
      });
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(workspaceId: string): Promise<void> {
    await prisma.$transaction([
      prisma.oAuthToken.deleteMany({ where: { workspaceId, scope: "TIKTOK" } }),
      prisma.socialAccount.deleteMany({ where: { workspaceId, platform: "TIKTOK" } }),
    ]);
  }
}