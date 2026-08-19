import { cn } from "@/lib/utils";
import { PLATFORM_COLORS, PLATFORM_LABELS } from "@/lib/constants";
import type { Platform } from "@prisma/client";

export function PlatformIcon({ platform, className }: { platform: Platform; className?: string }) {
  const color = PLATFORM_COLORS[platform];
  const label = PLATFORM_LABELS[platform];
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white",
        className
      )}
      style={{ backgroundColor: color }}
    >
      {platform === "YOUTUBE" ? "YT" : platform === "TIKTOK" ? "TT" : platform === "INSTAGRAM" ? "IG" : "FB"}
    </span>
  );
}

export function PlatformBadge({ platform, className }: { platform: Platform; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        className
      )}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[platform] }} />
      {PLATFORM_LABELS[platform]}
    </span>
  );
}