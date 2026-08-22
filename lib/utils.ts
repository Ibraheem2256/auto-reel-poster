import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number | bigint | null | undefined): string {
  if (bytes == null) return "-";
  const n = Number(bytes);
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "-";
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const unit = (s: number, name: string, ago: boolean) =>
    `${s} ${name}${s === 1 ? "" : "s"} ${ago ? "ago" : "from now"}`;
  if (abs < 60_000) return unit(Math.round(abs / 1000), "second", diff > 0);
  if (abs < 3_600_000) return unit(Math.round(abs / 60_000), "minute", diff > 0);
  if (abs < 86_400_000) return unit(Math.round(abs / 3_600_000), "hour", diff > 0);
  if (abs < 604_800_000) return unit(Math.round(abs / 86_400_000), "day", diff > 0);
  return d.toLocaleDateString();
}

export function formatDateTime(
  date: Date | string | null | undefined,
  timezone?: string
): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone || "UTC",
  }).format(d);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function isVideoMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return [
    "video/mp4",
    "video/quicktime",
    "video/x-m4v",
    "video/webm",
    "application/octet-stream",
    "video/x-matroska",
    "video/mpeg",
  ].includes(mime);
}

export function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx === -1 ? "" : fileName.slice(idx + 1).toLowerCase();
}

export function stripExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx === -1 ? fileName : fileName.slice(0, idx);
}

export function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}

/** Strip AI thinking/reasoning artifacts from a display title. */
export function cleanTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  let cleaned = title;
  // Remove <think>...</think> blocks
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // Remove "Here's a thinking process" and everything after it until real content
  cleaned = cleaned.replace(/^Here's?\s+(?:a\s+)?thinking[\s\S]*$/gim, "").trim();
  // Remove step-by-step reasoning lines
  const lines = cleaned.split("\n").filter((line) => {
    const t = line.trim();
    if (/^\d+[\.\)]\s*\*{0,2}(Analyze|Check|Consider|Determine|Evaluate|Identify|Look|Review|Write|Task|Input|Requirements)/i.test(t)) return false;
    if (/^\*{2}(Analyze|Check|Consider|Determine|Evaluate|Identify|Look|Review|Write|Task|Input|Requirements)/i.test(t)) return false;
    return true;
  });
  cleaned = lines.join("\n").trim();
  // If nothing meaningful left, return null so caller can fallback to fileName
  return cleaned.length > 0 ? cleaned : null;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

export function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}