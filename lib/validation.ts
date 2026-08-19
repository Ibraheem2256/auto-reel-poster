import { z } from "zod";

export const folderLinkSchema = z
  .string()
  .min(1, "Folder link is required")
  .refine((link) => extractFolderId(link) !== null, {
    message:
      "Invalid Google Drive folder link. Expected format: https://drive.google.com/drive/folders/XXXX",
  });

export function extractFolderId(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.hostname !== "drive.google.com") return null;
  const idParam = url.searchParams.get("id");
  if (idParam) return idParam;
  const folderParam = url.searchParams.get("folder");
  if (folderParam) return folderParam;
  const segments = url.pathname.split("/").filter(Boolean);
  const folderIdx = segments.findIndex((s) => s === "folders");
  if (folderIdx !== -1 && segments[folderIdx + 1]) return segments[folderIdx + 1];
  const openIdx = segments.findIndex((s) => s === "open");
  if (openIdx !== -1 && segments[openIdx + 1]) return segments[openIdx + 1];
  return null;
}

export const scheduleSchema = z
  .object({
    name: z.string().min(1).max(100).default("Default Schedule"),
    timezone: z.string().min(1),
    scheduleType: z.enum(["FIXED_TIMES", "INTERVAL", "PLATFORM_SPECIFIC", "BEST_TIMES"]),
    postsPerDay: z.number().int().min(1).max(24),
    times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(24),
    intervalHours: z.number().int().min(1).max(24).optional(),
    platforms: z.array(z.enum(["TIKTOK", "YOUTUBE", "INSTAGRAM", "FACEBOOK"])).min(1),
    platformTimes: z.record(z.string(), z.array(z.string())).optional(),
    enabled: z.boolean().default(true),
  })
  .superRefine((val, ctx) => {
    if (val.scheduleType === "FIXED_TIMES" && val.times.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["times"], message: "At least one time is required" });
    }
    if (val.scheduleType === "INTERVAL" && !val.intervalHours) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["intervalHours"], message: "Interval is required" });
    }
  });

export const settingsSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().min(1).optional(),
  queueOrder: z.enum(["OLDEST_FIRST", "NEWEST_FIRST", "RANDOM"]).optional(),
  captions: z
    .object({
      default: z.string().max(2200).default(""),
      platforms: z
        .object({
          TIKTOK: z.string().max(2200).optional(),
          YOUTUBE: z.string().max(5000).optional(),
          INSTAGRAM: z.string().max(2200).optional(),
          FACEBOOK: z.string().max(63206).optional(),
        })
        .optional(),
      useSameEverywhere: z.boolean().default(true),
    })
    .optional(),
  hashtags: z
    .object({
      default: z.array(z.string().max(50)).default([]),
      platforms: z.record(z.string(), z.array(z.string())).optional(),
    })
    .optional(),
  titleMode: z.enum(["FILENAME", "CUSTOM", "AI"]).optional(),
  customTitle: z.string().max(100).optional(),
  aiEnabled: z.boolean().optional(),
  aiSettings: z
    .object({
      niche: z.string().max(100).optional().default(""),
      audience: z.string().max(200).optional().default(""),
      instructions: z.string().max(1000).optional().default(""),
    })
    .optional(),
  autoEditEnabled: z.boolean().optional(),
  notificationsEmail: z.boolean().optional(),
  email: z.string().email().optional(),
});

export const driveScanSchema = z.object({
  force: z.boolean().optional(),
});

export const retrySchema = z.object({
  jobIds: z.array(z.string()).optional(),
});

export const automationSchema = z.object({
  enabled: z.boolean(),
  paused: z.boolean().optional(),
});