"use client";

import { useEffect, useState } from "react";
import { Clock, Film, Upload } from "lucide-react";

interface Props {
  scheduledAt: string | null;
  videoName: string | null;
}

function calc(diff: number) {
  if (diff <= 0) return { d: 0, h: 0, m: 0, s: 0, expired: true };
  return {
    d: Math.floor(diff / 86400000),
    h: Math.floor((diff % 86400000) / 3600000),
    m: Math.floor((diff % 3600000) / 60000),
    s: Math.floor((diff % 60000) / 1000),
    expired: false,
  };
}

function Digit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.02] text-3xl font-bold tabular-nums text-white shadow-lg backdrop-blur-sm sm:h-20 sm:w-20 sm:text-4xl">
          {String(value).padStart(2, "0")}
        </div>
      </div>
      <span className="mt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground sm:text-xs">
        {label}
      </span>
    </div>
  );
}

function Separator() {
  return (
    <div className="flex flex-col items-center gap-2 pb-6">
      <div className="h-1.5 w-1.5 rounded-full bg-brand-fuchsia/60" />
      <div className="h-1.5 w-1.5 rounded-full bg-brand-fuchsia/60" />
    </div>
  );
}

export default function NextUploadTimer({ scheduledAt, videoName }: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!scheduledAt) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.03] to-transparent p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06]">
            <Clock className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">No upcoming video</p>
            <p className="text-xs text-muted-foreground/60">Schedule a video to see the countdown.</p>
          </div>
        </div>
      </div>
    );
  }

  const diff = new Date(scheduledAt).getTime() - now;
  const t = calc(diff);

  if (t.expired) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/10 to-transparent p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15">
            <Upload className="h-5 w-5 text-emerald-400 animate-pulse" />
          </div>
          <div>
            <p className="text-sm font-semibold text-emerald-300">Uploading now...</p>
            <p className="text-xs text-emerald-400/60">{videoName}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br from-brand-violet/10 via-brand-fuchsia/5 to-white/[0.02] p-6 sm:p-8">
      {/* Glow effect */}
      <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-brand-fuchsia/10 blur-3xl" />
      <div className="absolute -bottom-20 -left-20 h-40 w-40 rounded-full bg-brand-violet/10 blur-3xl" />

      <div className="relative">
        <div className="mb-6 flex items-center gap-2 sm:mb-8">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-fuchsia/15">
            <Film className="h-4 w-4 text-brand-fuchsia" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-fuchsia/80">
              Next video uploads in
            </p>
            {videoName && (
              <p className="mt-0.5 max-w-[200px] truncate text-xs text-muted-foreground sm:max-w-none">
                {videoName}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-start justify-center gap-2 sm:gap-4">
          {t.d > 0 && (
            <>
              <Digit value={t.d} label="Days" />
              <Separator />
            </>
          )}
          <Digit value={t.h} label="Hours" />
          <Separator />
          <Digit value={t.m} label="Minutes" />
          <Separator />
          <Digit value={t.s} label="Seconds" />
        </div>
      </div>
    </div>
  );
}
