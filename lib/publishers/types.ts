import type { Platform, Video, Workspace, PlatformJob } from "@prisma/client";

export interface PublishContext {
  workspace: Workspace;
  video: Video;
  job: PlatformJob;
  // Computed content for this platform.
  title: string;
  caption: string;
  description: string;
  hashtags: string[];
  // Local path to the auto-edited video (9:16 + sound) when auto-edit is on.
  // When set, publishers upload this file instead of streaming from Drive.
  videoFilePath?: string;
}

export interface PublishResult {
  postId: string;
  postUrl?: string;
}

export interface PublisherErrorShape {
  code: string;
  message: string;
  retryable: boolean;
}

export class PublisherError extends Error {
  code: string;
  retryable: boolean;
  raw?: unknown;

  constructor(code: string, message: string, opts?: { retryable?: boolean; raw?: unknown }) {
    super(message);
    this.name = "PublisherError";
    this.code = code;
    this.retryable = opts?.retryable ?? false;
    this.raw = opts?.raw;
  }
}

export interface PrePublishCheckResult {
  ok: boolean;
  checks: { name: string; passed: boolean; message: string }[];
  error?: string;
}

export interface SocialPublisher {
  readonly platform: Platform;

  /** Validate the stored connection is usable (token valid, account reachable). */
  validateAccount(workspaceId: string): Promise<{ ok: boolean; accountName?: string; error?: string }>;

  /** Pre-publish confirmation: validates everything before uploading. */
  prePublishCheck?(ctx: PublishContext): Promise<PrePublishCheckResult>;

  /** Publish the video. Must clean up any temporary data after a successful upload. */
  publish(ctx: PublishContext): Promise<PublishResult>;

  /** Check status of a previously published post. */
  checkStatus(workspaceId: string, postId: string, videoId?: string): Promise<{
    status: "published" | "failed" | "pending";
    url?: string;
    views?: number;
    likes?: number;
    comments?: number;
  }>;

  /** Refresh/rotate tokens; returns false when reconnection is required. */
  refreshToken(workspaceId: string): Promise<boolean>;

  /** Revoke access / clean up server-side state when user disconnects. */
  disconnect(workspaceId: string): Promise<void>;
}

export interface CaptionBuilderInput {
  video: Video;
  workspace: Workspace;
  platform: Platform;
}

export function buildCaptionFor(input: CaptionBuilderInput): {
  title: string;
  caption: string;
  description: string;
  hashtags: string[];
} {
  const workspace = input.workspace;
  const captions = (workspace.captions as {
    default?: string;
    useSameEverywhere?: boolean;
    platforms?: Record<string, string>;
  } | null) ?? { default: "", useSameEverywhere: true };
  const hashtags = (workspace.hashtags as {
    default?: string[];
    platforms?: Record<string, string[]>;
  } | null) ?? { default: [] };

  const useSame = captions.useSameEverywhere ?? true;
  const platformCaption = useSame
    ? (captions.default ?? "")
    : ((captions.platforms?.[input.platform] ?? "") || (captions.default ?? ""));

  const platformHashtags = hashtags.platforms?.[input.platform]?.length
    ? hashtags.platforms[input.platform]
    : (hashtags.default ?? []);

  const hashTagText = platformHashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");

  // Title: FILENAME (default) | CUSTOM | AI
  const baseName = input.video.fileName.replace(/\.(mp4|mov|m4v|webm)$/i, "");
  let title = baseName;
  if (workspace.titleMode === "CUSTOM" && workspace.customTitle) {
    title = workspace.customTitle
      .replace(/\{filename\}/g, baseName)
      .slice(0, 100);
  } else if (workspace.titleMode === "AI") {
    title = `${baseName} #shorts`; // AI-generated titles replace this via lib/ai.ts
  }

  const caption = [platformCaption, hashTagText].filter(Boolean).join("\n\n");
  return { title, caption, description: caption, hashtags: platformHashtags };
}

export const PLATFORM_NAMES: Record<Platform, string> = {
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
};