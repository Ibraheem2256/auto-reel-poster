"use client";

import { useEffect, useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { PLATFORM_LABELS, PLATFORM_COLORS } from "@/lib/constants";
import type { Platform } from "@prisma/client";
import { Clock, TrendingUp, Zap } from "lucide-react";

interface TimeSlot {
  hour: number;
  label: string;
  avgViews: number;
  avgEngagement: number;
  postCount: number;
  score: number;
  isPeak: boolean;
}

interface PlatformTiming {
  platform: Platform;
  bestSlots: TimeSlot[];
  worstSlots: TimeSlot[];
  currentScheduleFit: number;
  recommendation: string;
  peakWindows: { start: number; end: number; label: string }[];
}

interface TimingReport {
  platforms: PlatformTiming[];
  overallBestTime: string;
  scheduleSuggestions: { platform: Platform; times: string[] }[];
}

function HourBar({ slot, maxScore }: { slot: TimeSlot; maxScore: number }) {
  const height = maxScore > 0 ? (slot.score / maxScore) * 100 : 0;
  const color = slot.isPeak
    ? "bg-gradient-to-t from-brand-violet to-brand-fuchsia"
    : slot.score > 60
    ? "bg-emerald-500/80"
    : slot.score > 30
    ? "bg-amber-500/60"
    : "bg-muted/40";
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] text-muted-foreground">{slot.avgViews}</span>
      <div className="relative w-full" style={{ height: "80px" }}>
        <div
          className={`absolute bottom-0 w-full rounded-t ${color} transition-all duration-500`}
          style={{ height: `${Math.max(4, height)}%` }}
        />
      </div>
      <span className="text-[9px] text-muted-foreground">{slot.label}</span>
    </div>
  );
}

export default function TimingPage() {
  const [data, setData] = useState<TimingReport | null>(null);

  useEffect(() => {
    fetch("/api/timing")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="Timing Optimizer"
        description="Best posting time analysis based on your actual performance data."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Best Time to Post"
          value={data.overallBestTime}
          icon={<Clock className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="Platforms Analyzed"
          value={data.platforms.length}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="Peak Windows"
          value={data.platforms.reduce((s, p) => s + p.peakWindows.length, 0)}
          icon={<Zap className="h-4 w-4" />}
        />
      </div>

      <div className="mt-6 space-y-6">
        {data.platforms.map((pt) => {
          const maxScore = Math.max(1, ...pt.bestSlots.map((s) => s.score));
          return (
            <Card key={pt.platform}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: PLATFORM_COLORS[pt.platform] }}
                  />
                  {PLATFORM_LABELS[pt.platform]}
                  <span className="ml-auto text-xs text-muted-foreground">
                    Schedule Fit: {pt.currentScheduleFit}%
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Hourly Chart */}
                <div className="flex items-end gap-0.5 overflow-x-auto pb-2">
                  {pt.bestSlots.map((slot) => (
                    <HourBar key={slot.hour} slot={slot} maxScore={maxScore} />
                  ))}
                </div>

                {/* Best Slots */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <h4 className="mb-2 text-xs font-semibold text-emerald-400">Best Times</h4>
                    <div className="space-y-1.5">
                      {pt.bestSlots.slice(0, 3).map((slot) => (
                        <div
                          key={slot.hour}
                          className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-xs"
                        >
                          <span className="font-medium">{slot.label}</span>
                          <span className="text-muted-foreground">
                            {slot.avgViews} avg views · {slot.postCount} posts
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="mb-2 text-xs font-semibold text-rose-400">Worst Times</h4>
                    <div className="space-y-1.5">
                      {pt.worstSlots.slice(0, 3).map((slot) => (
                        <div
                          key={slot.hour}
                          className="flex items-center justify-between rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-1.5 text-xs"
                        >
                          <span className="font-medium">{slot.label}</span>
                          <span className="text-muted-foreground">
                            {slot.avgViews} avg views · {slot.postCount} posts
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Recommendation */}
                <div className="rounded-lg border border-brand-violet/20 bg-brand-violet/5 p-3">
                  <p className="text-xs text-muted-foreground">{pt.recommendation}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quick Schedule Suggestions */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Quick Schedule Suggestions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.scheduleSuggestions.map((s) => (
              <div key={s.platform} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: PLATFORM_COLORS[s.platform] }}
                  />
                  {PLATFORM_LABELS[s.platform]}
                </h4>
                <ul className="mt-2 space-y-1">
                  {s.times.map((t, i) => (
                    <li key={i} className="text-xs text-muted-foreground">{t}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
