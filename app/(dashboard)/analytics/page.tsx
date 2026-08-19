"use client";

import { useEffect, useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { PLATFORM_LABELS } from "@/lib/constants";
import type { Platform } from "@prisma/client";

interface AnalyticsData {
  stats: {
    totalVideos: number;
    videosInQueue: number;
    scheduledToday: number;
    postedToday: number;
    totalPosted: number;
    failedJobs: number;
    accounts: number;
  };
  byDay: Record<string, number>;
  byPlatform: { platform: Platform; status: string; _count: { _all: number } }[];
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return <LoadingState />;

  const platformSummary = (Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => {
    const rows = data.byPlatform.filter((r) => r.platform === p);
    const total = rows.reduce((acc, r) => acc + r._count._all, 0);
    const success = rows.find((r) => r.status === "SUCCESS")?._count._all ?? 0;
    const failed = rows.find((r) => r.status === "FAILED")?._count._all ?? 0;
    return { platform: p, total, success, failed };
  });

  const maxDay = Math.max(1, ...Object.values(data.byDay));

  return (
    <div>
      <PageHeader title="Analytics" description="Performance of your publishing pipeline." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Videos Detected" value={data.stats.totalVideos} />
        <StatCard label="In Queue" value={data.stats.videosInQueue} />
        <StatCard label="Scheduled Today" value={data.stats.scheduledToday} />
        <StatCard label="Posted Today" value={data.stats.postedToday} tone="success" />
        <StatCard label="Total Posted" value={data.stats.totalPosted} tone="success" />
        <StatCard label="Failed Jobs" value={data.stats.failedJobs} tone={data.stats.failedJobs > 0 ? "destructive" : "default"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Posts per day (last 7 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-40 items-end gap-2">
              {Object.entries(data.byDay).map(([day, count]) => (
                <div key={day} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs font-medium">{count}</span>
                  <div className="w-full rounded-t bg-primary/80" style={{ height: `${Math.max(4, (count / maxDay) * 100)}px` }} />
                  <span className="text-[10px] text-muted-foreground">{day.slice(5)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">By platform</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {platformSummary.map((p) => (
              <div key={p.platform}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{PLATFORM_LABELS[p.platform]}</span>
                  <span className="text-muted-foreground">
                    {p.success} success · {p.failed} failed · {p.total} total
                  </span>
                </div>
                <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-muted">
                  <div className="bg-emerald-500" style={{ width: `${p.total ? (p.success / p.total) * 100 : 0}%` }} />
                  <div className="bg-destructive" style={{ width: `${p.total ? (p.failed / p.total) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}