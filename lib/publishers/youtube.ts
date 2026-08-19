import { google } from "googleapis";
import { createReadStream } from "fs";
import { prisma } from "@/lib/prisma";
import { streamVideoFromDrive } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { getValidAccessToken } from "@/lib/google";
import { upsertSocialAccount, getPlatformToken, markTokenExpired } from "@/lib/publishers/tokens";
import { PublisherError, type PublishContext, type PublishResult, type PrePublishCheckResult, type SocialPublisher } from "@/lib/publishers/types";
import type { Platform } from "@prisma/client";

// "public" | "unlisted" | "private" — set via YOUTUBE_PRIVACY_STATUS env.
const PRIVACY_STATUS = (process.env.YOUTUBE_PRIVACY_STATUS ?? "public") as "public" | "unlisted" | "private";

const COPYRIGHT_PATTERNS = [/copyright/i, /duplicate/i, /rejected/i, /strike/i, /content\s*id/i, /infring/i];

export class YouTubePublisher implements SocialPublisher {
  readonly platform: Platform = "YOUTUBE";

  private getClient(accessToken: string) {
    const oauth = new google.auth.OAuth2({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    });
    oauth.setCredentials({ access_token: accessToken });
    return google.youtube({ version: "v3", auth: oauth });
  }

  /**
   * Fetch a usable token, refreshing the stored one automatically when it
   * has expired. Returns null when there is no connection or the refresh
   * itself failed.
   */
  private async getUsableToken(workspaceId: string): Promise<string | null> {
    try {
      return await getValidAccessToken(workspaceId, "YOUTUBE");
    } catch {
      return null;
    }
  }

  private isAuthError(err: unknown): boolean {
    const raw = err as { errors?: { message?: string; reason?: string }[] };
    const code = raw.errors?.[0]?.reason ?? "";
    const message =
      raw.errors?.[0]?.message ?? (err instanceof Error ? err.message : String(err));
    return (
      code === "authError" ||
      code === "tokenExpired" ||
      code === "invalid_grant" ||
      /invalid credentials/i.test(message) ||
      /invalid_grant/i.test(message) ||
      /expired/i.test(message)
    );
  }

  private errorCodeAndMessage(err: unknown): { code: string; message: string } {
    const raw = err as { errors?: { code?: number; message?: string; reason?: string }[] };
    const code = raw.errors?.[0]?.reason ?? "YOUTUBE_API_ERROR";
    const message = raw.errors?.[0]?.message ?? (err instanceof Error ? err.message : String(err));
    return { code, message };
  }

  async validateAccount(workspaceId: string) {
    const accessToken = await this.getUsableToken(workspaceId);
    if (!accessToken) {
      markTokenExpired(workspaceId, "YOUTUBE", "YouTube authorization expired. Reconnect to continue.");
      return { ok: false, error: "YouTube authorization expired. Reconnect to continue." };
    }
    try {
      const youtube = this.getClient(accessToken);
      const res = await youtube.channels.list({ part: ["snippet"], mine: true });
      const channel = res.data.items?.[0];
      if (!channel?.id) return { ok: false, error: "No YouTube channel found on this account." };
      const token = await getPlatformToken(workspaceId, "YOUTUBE");
      await upsertSocialAccount({
        workspaceId,
        platform: "YOUTUBE",
        platformAccountId: channel.id,
        accountName: channel.snippet?.title ?? "YouTube channel",
        avatarUrl: channel.snippet?.thumbnails?.default?.url ?? null,
        scopes: "youtube.upload youtube.readonly",
        expiresAt: token?.expiresAt ?? null,
      });
      return { ok: true, accountName: channel.snippet?.title ?? "YouTube channel" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.isAuthError(err)) {
        markTokenExpired(workspaceId, "YOUTUBE", "YouTube authorization expired. Reconnect to continue.");
      }
      return { ok: false, error: message.slice(0, 300) };
    }
  }

  async prePublishCheck(ctx: PublishContext): Promise<PrePublishCheckResult> {
    const checks: PrePublishCheckResult["checks"] = [];
    const { video, title, description, hashtags } = ctx;

    // 1. Account connected & token valid
    const accountCheck = await this.validateAccount(ctx.workspace.id);
    checks.push({
      name: "YouTube account connected",
      passed: accountCheck.ok,
      message: accountCheck.ok
        ? `Connected as: ${accountCheck.accountName}`
        : accountCheck.error ?? "Not connected",
    });
    if (!accountCheck.ok) {
      return { ok: false, checks, error: "YouTube account is not connected or authorization expired." };
    }

    // 2. Video duration within YouTube Shorts limit (for Shorts) or regular limit
    const isVertical = (video.height ?? 0) >= (video.width ?? 0);
    const durationSec = (video.durationMs ?? 0) / 1000;
    const maxSec = isVertical && durationSec <= 180 ? 180 : 3600;
    const minSec = 1;
    const durationOk = durationSec >= minSec && durationSec <= maxSec;
    checks.push({
      name: "Video duration valid",
      passed: durationOk,
      message: durationOk
        ? `${Math.round(durationSec)}s — ${isVertical && durationSec <= 180 ? "Shorts eligible" : "Regular video"}`
        : `Duration ${Math.round(durationSec)}s is outside YouTube limits (${minSec}s–${maxSec}s).`,
    });

    // 3. Title length (max 100 chars for YouTube)
    const titleOk = title.length > 0 && title.length <= 100;
    checks.push({
      name: "Title length OK",
      passed: titleOk,
      message: titleOk
        ? `${title.length}/100 characters`
        : title.length === 0
          ? "Title is empty"
          : `Title too long (${title.length}/100 characters). Will be truncated.`,
    });

    // 4. Description length (max 5000 chars for YouTube)
    const descOk = description.length <= 5000;
    checks.push({
      name: "Description length OK",
      passed: descOk,
      message: descOk
        ? `${description.length}/5000 characters`
        : `Description too long (${description.length}/5000 characters). Will be truncated.`,
    });

    // 5. Tags count (max 15 for YouTube)
    const tagsOk = hashtags.length <= 15;
    checks.push({
      name: "Tags count OK",
      passed: tagsOk,
      message: tagsOk
        ? `${hashtags.length} tags`
        : `${hashtags.length} tags — will be trimmed to 15.`,
    });

    // 6. File size check (YouTube limit ~256GB, but warn if > 1GB)
    const fileSizeBytes = video.fileSize ? Number(video.fileSize) : 0;
    const sizeOk = !fileSizeBytes || fileSizeBytes <= 1_000_000_000;
    checks.push({
      name: "File size OK",
      passed: sizeOk,
      message: sizeOk
        ? fileSizeBytes ? `${(fileSizeBytes / 1_000_000).toFixed(1)} MB` : "Size unknown"
        : `File is ${(fileSizeBytes / 1_000_000_000).toFixed(1)} GB — YouTube upload may be slow.`,
    });

    // 7. Copyright risk check (basic filename-based heuristic)
    const copyrightSuspicious = /music|song|remix|beat|audio|soundtrack|official/i.test(video.fileName);
    if (copyrightSuspicious) {
      checks.push({
        name: "Copyright risk warning",
        passed: false,
        message: `Filename "${video.fileName}" may contain copyrighted content. YouTube may flag or remove this video.`,
      });
    }

    const allPassed = checks.every((c) => c.passed);
    return {
      ok: allPassed,
      checks,
      error: allPassed ? undefined : "Some checks failed. Review before publishing.",
    };
  }

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const { video, caption, title, description, hashtags } = ctx;

    const uploadWithToken = async (accessToken: string): Promise<string> => {
      const stream = ctx.videoFilePath
        ? createReadStream(ctx.videoFilePath)
        : await streamVideoFromDrive(ctx.workspace.id, video.driveFileId);
      const youtube = this.getClient(accessToken);
      const res = await youtube.videos.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: title.slice(0, 100),
            description: description.slice(0, 5000),
            tags: hashtags.slice(0, 15).map((h) => h.replace(/^#/, "")),
            categoryId: "22", // People & Blogs
            defaultLanguage: "en",
          },
          status: {
            privacyStatus: PRIVACY_STATUS,
            selfDeclaredMadeForKids: false,
          },
        },
        media: {
          mimeType: ctx.videoFilePath ? "video/mp4" : video.mimeType || "video/mp4",
          body: stream,
        },
      });
      const videoId = res.data.id;
      if (!videoId) {
        throw new PublisherError("UPLOAD_FAILED", "YouTube did not return a video ID.", { retryable: true });
      }
      return videoId;
    };

    const recordPost = async (videoId: string): Promise<PublishResult> => {
      // Shorts are auto-detected by YouTube from vertical aspect + short duration;
      // we still record what we know.
      const isShort = (video.height ?? 0) >= (video.width ?? 0) && (video.durationMs ?? 0) <= 180_000;

      // Post URL after processing (may not be immediately public).
      const postUrl = isShort
        ? `https://www.youtube.com/shorts/${videoId}`
        : `https://www.youtube.com/watch?v=${videoId}`;

      await prisma.platformPost.create({
        data: {
          platformJobId: ctx.job.id,
          videoId: video.id,
          platform: "YOUTUBE",
          platformPostId: videoId,
          platformPostUrl: postUrl,
          metadata: { isShort, privacyStatus: PRIVACY_STATUS },
        },
      });

      return { postId: videoId, postUrl };
    };

    // 1. Get a valid token — auto-refreshes the stored access token when the
    //    hour-long Google access token has expired (no reconnect needed).
    const accessToken = await this.getUsableToken(ctx.workspace.id);
    if (!accessToken) {
      markTokenExpired(ctx.workspace.id, "YOUTUBE", "YouTube authorization expired or missing. Reconnect to continue.");
      throw new PublisherError(
        "NOT_CONNECTED",
        "YouTube is not connected or its authorization expired. Reconnect to continue.",
        { retryable: false }
      );
    }

    try {
      let videoId: string;
      try {
        videoId = await uploadWithToken(accessToken);
      } catch (err) {
        // 2. The token may have expired between the check and the upload.
        //    Refresh once and retry before declaring the account dead.
        if (!this.isAuthError(err)) throw err;
        const refreshed = await this.refreshToken(ctx.workspace.id);
        if (!refreshed) throw err;
        const freshToken = await this.getUsableToken(ctx.workspace.id);
        if (!freshToken) throw err;
        videoId = await uploadWithToken(freshToken);
      }
      return await recordPost(videoId);
    } catch (err) {
      const { code, message } = this.errorCodeAndMessage(err);
      if (this.isAuthError(err)) {
        markTokenExpired(ctx.workspace.id, "YOUTUBE", message.slice(0, 500));
      }
      const isCopyright = COPYRIGHT_PATTERNS.some((re) => re.test(message) || re.test(code));
      if (isCopyright) {
        await prisma.notification.create({
          data: {
            workspaceId: ctx.workspace.id,
            type: "COPYRIGHT_ISSUE",
            title: `Copyright issue — "${video.fileName}" was not published`,
            message: `YouTube rejected the upload because of a copyright or duplicate content issue: ${message.slice(0, 300)}. The video stays in your Drive — nothing was deleted.`,
          },
        });
        logger.warn("youtube_copyright_rejected", { workspaceId: ctx.workspace.id, videoId: video.id, message: message.slice(0, 300) });
        throw new PublisherError("COPYRIGHT_REJECTED", message.slice(0, 1000), { retryable: false, raw: err });
      }
      throw new PublisherError(code, message.slice(0, 1000), { retryable: code !== "invalidParameter" && code !== "quotaExceeded", raw: err });
    }
  }

  async checkStatus(workspaceId: string, postId: string, videoId?: string) {
    const accessToken = await this.getUsableToken(workspaceId);
    if (!accessToken) return { status: "pending" as const };
    try {
      const youtube = this.getClient(accessToken);
      const res = await youtube.videos.list({ id: [postId], part: ["status", "contentDetails", "statistics"] });
      const item = res.data.items?.[0];
      if (!item) {
        await prisma.notification.create({
          data: {
            workspaceId,
            type: "COPYRIGHT_ISSUE",
            title: "YouTube removed or blocked a posted video",
            message: `The uploaded video (${postId}) is no longer available on YouTube. It may have been removed because of a copyright claim or a Community Guidelines violation. The video stays in your Drive — nothing was deleted.`,
          },
        });
        return { status: "failed" as const };
      }
      const duration = item.contentDetails?.duration ?? "";
      const seconds = /PT(\d+)M(\d+)S/.exec(duration);
      return {
        status: "published" as const,
        url: item.status?.privacyStatus !== "private"
          ? `https://www.youtube.com/watch?v=${postId}`
          : undefined,
        views: item.statistics?.viewCount ? Number(item.statistics.viewCount) : 0,
        likes: item.statistics?.likeCount ? Number(item.statistics.likeCount) : 0,
        comments: item.statistics?.commentCount ? Number(item.statistics.commentCount) : 0,
      };
    } catch {
      return { status: "pending" as const };
    }
  }

  async refreshToken(workspaceId: string): Promise<boolean> {
    const token = await getPlatformToken(workspaceId, "YOUTUBE");
    if (!token) return false;
    if (!token.refreshToken) return false;
    try {
      const oauth = new google.auth.OAuth2({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      });
      oauth.setCredentials({ refresh_token: token.refreshToken });
      const { credentials } = await oauth.refreshAccessToken();
      if (!credentials.access_token) return false;
      const { savePlatformToken } = await import("@/lib/publishers/tokens");
      await savePlatformToken(workspaceId, "YOUTUBE", {
        accessToken: credentials.access_token,
        refreshToken: token.refreshToken,
        expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
      });
      await prisma.socialAccount.updateMany({
        where: { workspaceId, platform: "YOUTUBE" },
        data: { status: "CONNECTED", lastError: null },
      });
      logger.info("youtube_token_refreshed", { workspaceId });
      return true;
    } catch (err) {
      logger.warn("youtube_refresh_failed", { workspaceId, error: String(err) });
      return false;
    }
  }

  async disconnect(workspaceId: string): Promise<void> {
    await prisma.$transaction([
      prisma.oAuthToken.deleteMany({ where: { workspaceId, scope: "YOUTUBE" } }),
      prisma.socialAccount.deleteMany({ where: { workspaceId, platform: "YOUTUBE" } }),
    ]);
  }
}