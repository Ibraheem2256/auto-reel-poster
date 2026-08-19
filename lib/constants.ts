import type { Platform } from "@prisma/client";

export const PLATFORMS: Platform[] = ["TIKTOK", "YOUTUBE", "INSTAGRAM", "FACEBOOK"];

export const PLATFORM_LABELS: Record<Platform, string> = {
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
};

export const PLATFORM_COLORS: Record<Platform, string> = {
  TIKTOK: "#FE2C55",
  YOUTUBE: "#FF0000",
  INSTAGRAM: "#E4405F",
  FACEBOOK: "#1877F2",
};

export const SUPPORTED_EXTENSIONS = ["mp4", "mov", "m4v", "webm"];

// Limits applied during validation (platform-safe defaults).
export const VIDEO_LIMITS = {
  maxSizeBytes: 1 * 1024 * 1024 * 1024, // 1 GB
  minDurationMs: 5_000, // 5 seconds (TikTok minimum)
  maxDurationMs: 10 * 60_000, // 10 minutes
  minWidth: 320,
  minHeight: 320,
} as const;

// Drive scan interval in minutes (configurable; free-tier friendly default).
export const DEFAULT_SCAN_INTERVAL_MINUTES = 10;
export const MIN_SCAN_INTERVAL_MINUTES = 5;

// Temporary files expire after 1 hour.
export const TEMP_FILE_TTL_MS = 60 * 60 * 1000;
export const TEMP_FILE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // hard cleanup cutoff

// Retry backoff in minutes: attempt -> delay
export const RETRY_BACKOFF_MINUTES = [5, 30, 120];
export const MAX_ATTEMPTS = RETRY_BACKOFF_MINUTES.length + 1;

export const QUEUE_ORDERS = ["OLDEST_FIRST", "NEWEST_FIRST", "RANDOM"] as const;

export const TITLE_MODES = ["FILENAME", "CUSTOM", "AI"] as const;

export const APP_NAME = "Auto Reel Poster";

export const TIMEZONE_OPTIONS = [
  "Asia/Karachi",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Riyadh",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "UTC",
] as const;

// Platform-specific validation rules (checked before upload).
export const PLATFORM_VIDEO_RULES: Record<
  Platform,
  { maxDurationMs: number; minDurationMs: number; note?: string }
> = {
  TIKTOK: { maxDurationMs: 10 * 60_000, minDurationMs: 3_000 },
  YOUTUBE: { maxDurationMs: 60 * 60_000, minDurationMs: 1_000 },
  INSTAGRAM: { maxDurationMs: 15 * 60_000, minDurationMs: 3_000 },
  FACEBOOK: { maxDurationMs: 60 * 60_000, minDurationMs: 1_000 },
};

// Peak audience activity windows per platform, in the user's local time (24h).
// Based on industry engagement research for short-form video audiences.
// Each window is [startHour, endHour] — the end hour is exclusive.
export const BEST_TIME_WINDOWS: Record<Platform, { start: number; end: number }[]> = {
  TIKTOK: [
    { start: 12, end: 15 }, // lunch break
    { start: 18, end: 22 }, // evening peak (19–21 is the strongest)
  ],
  YOUTUBE: [
    { start: 12, end: 15 }, // midday
    { start: 17, end: 20 }, // after work / evening
  ],
  INSTAGRAM: [
    { start: 11, end: 14 }, // late morning
    { start: 19, end: 21 }, // evening
  ],
  FACEBOOK: [
    { start: 9, end: 13 }, // morning (weekday strong)
    { start: 19, end: 21 }, // evening
  ],
};

export const BEST_TIME_LABELS: Record<Platform, string> = {
  TIKTOK: "12pm–3pm and 6pm–10pm (evening is peak)",
  YOUTUBE: "12pm–3pm and 5pm–8pm",
  INSTAGRAM: "11am–2pm and 7pm–9pm",
  FACEBOOK: "9am–1pm and 7pm–9pm",
};

export const CRON_AUTH_HEADER = "x-cron-secret";
export const WEBHOOK_SECRET_HEADER = "x-webhook-secret";