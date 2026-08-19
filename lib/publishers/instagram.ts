import { createReadStream } from "fs";
import { prisma } from "@/lib/prisma";
import { streamVideoFromDrive, buildMultipartBody } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { upsertSocialAccount, markTokenExpired } from "@/lib/publishers/tokens";
import { getMetaToken, graphGet, graphPostFormData, graphPostJson } from "@/lib/publishers/meta";
import { PublisherError, type PublishContext, type PublishResult, type SocialPublisher } from "@/lib/publishers/types";
import type { Platform } from "@prisma/client";

const IG_MAX_FILE_BYTES = 100 * 1024 * 1024; // Meta's in-multipart limit for IG

export class InstagramPublisher implements SocialPublisher {
  readonly platform: Platform = "INSTAGRAM";

  async validateAccount(workspaceId: string) {
    const token = await getMetaToken(workspaceId, "INSTAGRAM");
    if (!token) return { ok: false, error: "Instagram is not connected." };
    try {
      // The stored account is an Instagram Business account id.
      const account = await prisma.socialAccount.findFirst({
        where: { workspaceId, platform: "INSTAGRAM" },
      });
      if (!account) return { ok: false, error: "No Instagram account found." };
      const me = await graphGet<{ username?: string; name?: string; error?: { message?: string } }>(
        `/${account.platformAccountId}`,
        { fields: "username,name", access_token: token.accessToken }
      );
      await upsertSocialAccount({
        workspaceId,
        platform: "INSTAGRAM",
        platformAccountId: account.platformAccountId,
        accountName: me.name || me.username || account.accountName,
        expiresAt: token.expiresAt,
      });
      return { ok: true, accountName: me.name || me.username || account.accountName };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Session has expired") || message.includes("OAuthException")) {
        markTokenExpired(workspaceId, "INSTAGRAM", message.slice(0, 500));
      }
      return { ok: false, error: message.slice(0, 300) };
    }
  }

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const token = await getMetaToken(ctx.workspace.id, "INSTAGRAM");
    if (!token) throw new PublisherError("NOT_CONNECTED", "Instagram is not connected.", { retryable: false });

    const account = await prisma.socialAccount.findFirst({
      where: { workspaceId: ctx.workspace.id, platform: "INSTAGRAM" },
    });
    if (!account) throw new PublisherError("NO_ACCOUNT", "Instagram account is not connected.", { retryable: false });

    const { video, caption } = ctx;
    if (video.fileSize && Number(video.fileSize) > IG_MAX_FILE_BYTES) {
      throw new PublisherError("FILE_TOO_LARGE", "Instagram accepts video files up to 100 MB.", { retryable: false });
    }

    const stream = ctx.videoFilePath
      ? createReadStream(ctx.videoFilePath)
      : await streamVideoFromDrive(ctx.workspace.id, video.driveFileId);
    const fileName = ctx.videoFilePath ? "edited.mp4" : video.fileName;
    const mimeType = ctx.videoFilePath ? "video/mp4" : video.mimeType || "video/mp4";
    const { body, contentType } = buildMultipartBody(
      {
        access_token: token.accessToken,
        media_type: "REELS",
        caption: caption.slice(0, 2200),
        share_to_feed: "1",
      },
      stream,
      fileName,
      mimeType
    );

    let creationId: string | undefined;
    try {
      const created = await graphPostFormData(`/${account.platformAccountId}/media`, body, contentType);
      creationId = created.id;
      if (!creationId) throw new PublisherError("IG_CREATION_FAILED", "Instagram did not return a media container.", { retryable: true });

      // Poll container status until FINISHED.
      const deadline = Date.now() + 150_000;
      let status = "IN_PROGRESS";
      while (Date.now() < deadline) {
        const res = await graphGet<{ status_code?: string; error?: { message?: string } }>(
          `/${creationId}`,
          { fields: "status_code", access_token: token.accessToken }
        );
        status = res.status_code ?? "IN_PROGRESS";
        if (status === "FINISHED") break;
        if (status === "ERROR") throw new PublisherError("IG_CONTAINER_ERROR", "Instagram could not process the video.", { retryable: true });
        await new Promise((r) => setTimeout(r, 5000));
      }
      if (status !== "FINISHED") {
        throw new PublisherError("IG_TIMEOUT", "Instagram container processing timed out.", { retryable: true });
      }

      const published = await graphPostJson(`/${account.platformAccountId}/media_publish`, {
        creation_id: creationId,
        access_token: token.accessToken,
      });
      const mediaId = published.id;
      if (!mediaId) throw new PublisherError("IG_PUBLISH_FAILED", "Instagram did not return a media ID.", { retryable: true });

      await prisma.platformPost.create({
        data: {
          platformJobId: ctx.job.id,
          videoId: video.id,
          platform: "INSTAGRAM",
          platformPostId: mediaId,
          platformPostUrl: `https://www.instagram.com/p/${mediaId}/`,
        },
      });
      return { postId: mediaId, postUrl: `https://www.instagram.com/p/${mediaId}/` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Session has expired") || message.includes("OAuthException")) {
        markTokenExpired(ctx.workspace.id, "INSTAGRAM", message.slice(0, 500));
      }
      throw err;
    }
  }

  async checkStatus(workspaceId: string, postId: string, videoId?: string) {
    const token = await getMetaToken(workspaceId, "INSTAGRAM");
    if (!token) return { status: "pending" as const };
    try {
      const res = await graphGet<{ media_type?: string; permalink?: string }>(`/${postId}`, {
        fields: "media_type,permalink",
        access_token: token.accessToken,
      });
      return { status: "published" as const, url: res.permalink };
    } catch {
      return { status: "failed" as const };
    }
  }

  async refreshToken(workspaceId: string): Promise<boolean> {
    // Meta page tokens are long-lived (~60 days); if expired, reconnection is required.
    const token = await getMetaToken(workspaceId, "INSTAGRAM");
    if (!token) return false;
    if (token.expiresAt && token.expiresAt.getTime() > Date.now() + 7 * 24 * 3600_000) return true;
    return false;
  }

  async disconnect(workspaceId: string): Promise<void> {
    await prisma.$transaction([
      prisma.oAuthToken.deleteMany({ where: { workspaceId, scope: "INSTAGRAM" } }),
      prisma.socialAccount.deleteMany({ where: { workspaceId, platform: "INSTAGRAM" } }),
    ]);
  }
}