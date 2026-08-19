import { createReadStream } from "fs";
import { prisma } from "@/lib/prisma";
import { streamVideoFromDrive, buildMultipartBody } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { upsertSocialAccount, markTokenExpired } from "@/lib/publishers/tokens";
import { getMetaToken, graphGet, graphPostFormData } from "@/lib/publishers/meta";
import { PublisherError, type PublishContext, type PublishResult, type SocialPublisher } from "@/lib/publishers/types";
import type { Platform } from "@prisma/client";

export class FacebookPublisher implements SocialPublisher {
  readonly platform: Platform = "FACEBOOK";

  async validateAccount(workspaceId: string) {
    const token = await getMetaToken(workspaceId, "FACEBOOK");
    if (!token) return { ok: false, error: "Facebook is not connected." };
    try {
      const account = await prisma.socialAccount.findFirst({
        where: { workspaceId, platform: "FACEBOOK" },
      });
      if (!account) return { ok: false, error: "No Facebook page found." };
      const page = await graphGet<{ name?: string; picture?: { data?: { url?: string } }; error?: { message?: string } }>(
        `/${account.platformAccountId}`,
        { fields: "name,picture", access_token: token.accessToken }
      );
      await upsertSocialAccount({
        workspaceId,
        platform: "FACEBOOK",
        platformAccountId: account.platformAccountId,
        accountName: page.name ?? account.accountName,
        avatarUrl: page.picture?.data?.url ?? null,
        expiresAt: token.expiresAt,
      });
      return { ok: true, accountName: page.name ?? account.accountName };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Session has expired") || message.includes("OAuthException")) {
        markTokenExpired(workspaceId, "FACEBOOK", message.slice(0, 500));
      }
      return { ok: false, error: message.slice(0, 300) };
    }
  }

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const token = await getMetaToken(ctx.workspace.id, "FACEBOOK");
    if (!token) throw new PublisherError("NOT_CONNECTED", "Facebook is not connected.", { retryable: false });

    const account = await prisma.socialAccount.findFirst({
      where: { workspaceId: ctx.workspace.id, platform: "FACEBOOK" },
    });
    if (!account) throw new PublisherError("NO_ACCOUNT", "Facebook page is not connected.", { retryable: false });

    const { video, caption } = ctx;
    const stream = ctx.videoFilePath
      ? createReadStream(ctx.videoFilePath)
      : await streamVideoFromDrive(ctx.workspace.id, video.driveFileId);
    const fileName = ctx.videoFilePath ? "edited.mp4" : video.fileName;
    const mimeType = ctx.videoFilePath ? "video/mp4" : video.mimeType || "video/mp4";
    const { body, contentType } = buildMultipartBody(
      {
        access_token: token.accessToken,
        description: caption.slice(0, 63206),
      },
      stream,
      fileName,
      mimeType
    );

    try {
      const created = await graphPostFormData(`/${account.platformAccountId}/video_reels`, body, contentType);
      const postId = created.id;
      if (!postId) throw new PublisherError("FB_CREATION_FAILED", "Facebook did not return a post ID.", { retryable: true });

      const url = `https://www.facebook.com/${account.platformAccountId}/videos/${postId}`;
      await prisma.platformPost.create({
        data: {
          platformJobId: ctx.job.id,
          videoId: video.id,
          platform: "FACEBOOK",
          platformPostId: postId,
          platformPostUrl: url,
        },
      });
      return { postId, postUrl: url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Session has expired") || message.includes("OAuthException")) {
        markTokenExpired(ctx.workspace.id, "FACEBOOK", message.slice(0, 500));
      }
      throw err;
    }
  }

  async checkStatus(workspaceId: string, postId: string, videoId?: string) {
    const token = await getMetaToken(workspaceId, "FACEBOOK");
    if (!token) return { status: "pending" as const };
    try {
      const res = await graphGet<{ permalink_url?: string }>(`/${postId}`, {
        fields: "permalink_url",
        access_token: token.accessToken,
      });
      return { status: "published" as const, url: res.permalink_url };
    } catch {
      return { status: "failed" as const };
    }
  }

  async refreshToken(workspaceId: string): Promise<boolean> {
    const token = await getMetaToken(workspaceId, "FACEBOOK");
    if (!token) return false;
    if (token.expiresAt && token.expiresAt.getTime() > Date.now() + 7 * 24 * 3600_000) return true;
    return false;
  }

  async disconnect(workspaceId: string): Promise<void> {
    await prisma.$transaction([
      prisma.oAuthToken.deleteMany({ where: { workspaceId, scope: "FACEBOOK" } }),
      prisma.socialAccount.deleteMany({ where: { workspaceId, platform: "FACEBOOK" } }),
    ]);
  }
}