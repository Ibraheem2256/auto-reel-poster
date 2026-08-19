"use client";

import { useEffect, useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { PlatformBadge } from "@/components/platform-icons";
import { formatRelative } from "@/lib/utils";

interface AdminData {
  stats: {
    totalUsers: number;
    activeUsers: number;
    accounts: number;
    videosDetected: number;
    postsPublished: number;
    failedJobs: number;
    queueHealth: number;
    workspaces: number;
  };
  recentErrors: { id: string; platform: string; errorCode: string | null; errorMessage: string | null; updatedAt: string }[];
  apiVersion: string;
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Forbidden");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;

  return (
    <div>
      <PageHeader title="Admin" description="System-wide health and statistics." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Total Users" value={data.stats.totalUsers} />
        <StatCard label="Active Users (30d)" value={data.stats.activeUsers} />
        <StatCard label="Workspaces" value={data.stats.workspaces} />
        <StatCard label="Connected Accounts" value={data.stats.accounts} />
        <StatCard label="Videos Detected" value={data.stats.videosDetected} />
        <StatCard label="Posts Published" value={data.stats.postsPublished} tone="success" />
        <StatCard label="Failed Jobs" value={data.stats.failedJobs} tone={data.stats.failedJobs > 0 ? "destructive" : "default"} />
        <StatCard label="Queue Backlog" value={data.stats.queueHealth} tone={data.stats.queueHealth > 0 ? "warning" : "success"} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Recent failures (24h)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentErrors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failures in the last 24 hours.</p>
          ) : (
            <div className="space-y-2">
              {data.recentErrors.map((e) => (
                <div key={e.id} className="flex items-center gap-3 rounded-md border p-2.5 text-sm">
                  <PlatformBadge platform={e.platform as never} />
                  <span className="font-medium">{e.errorCode}</span>
                  <span className="flex-1 truncate text-muted-foreground">{e.errorMessage}</span>
                  <span className="text-xs text-muted-foreground">{formatRelative(e.updatedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">API version {data.apiVersion} · Tokens are never exposed here.</p>
    </div>
  );
}