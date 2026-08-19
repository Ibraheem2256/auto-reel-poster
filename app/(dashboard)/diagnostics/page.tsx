"use client";

import { useEffect, useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { PLATFORM_LABELS, PLATFORM_COLORS } from "@/lib/constants";
import type { Platform } from "@prisma/client";
import {
  AlertTriangle,
  CheckCircle,
  Info,
  TrendingUp,
  Eye,
  ThumbsUp,
  MessageCircle,
  Share2,
} from "lucide-react";

interface DiagnosticIssue {
  severity: "critical" | "warning" | "info";
  category: string;
  title: string;
  description: string;
  fix: string;
  impact: string;
}

interface PlatformDiagnostic {
  platform: Platform;
  totalPosted: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  avgViews: number;
  avgEngagementRate: number;
  issues: DiagnosticIssue[];
  score: number;
}

interface DiagnosticReport {
  overallScore: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  avgEngagementRate: number;
  platforms: PlatformDiagnostic[];
  topIssues: DiagnosticIssue[];
  recommendations: string[];
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444";
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;
  return (
    <div className="relative h-28 w-28">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/30" />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl font-bold" style={{ color }}>{score}</span>
        <span className="text-[10px] text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

function IssueCard({ issue }: { issue: DiagnosticIssue }) {
  const icon = issue.severity === "critical"
    ? <AlertTriangle className="h-4 w-4 text-rose-400" />
    : issue.severity === "warning"
    ? <AlertTriangle className="h-4 w-4 text-amber-400" />
    : <Info className="h-4 w-4 text-blue-400" />;
  const bg = issue.severity === "critical"
    ? "border-rose-500/20 bg-rose-500/5"
    : issue.severity === "warning"
    ? "border-amber-500/20 bg-amber-500/5"
    : "border-blue-500/20 bg-blue-500/5";

  return (
    <div className={`rounded-lg border p-4 ${bg}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{icon}</span>
        <div className="flex-1 space-y-1.5">
          <h4 className="text-sm font-semibold">{issue.title}</h4>
          <p className="text-xs text-muted-foreground">{issue.description}</p>
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-400">
              Fix: {issue.fix}
            </span>
          </div>
          <p className="text-[11px] text-brand-fuchsia/80">Impact: {issue.impact}</p>
        </div>
      </div>
    </div>
  );
}

export default function DiagnosticsPage() {
  const [data, setData] = useState<DiagnosticReport | null>(null);

  useEffect(() => {
    fetch("/api/diagnostics")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="Diagnostic Engine"
        description="Views kyun nahi aa rahe? Full analysis aur fix suggestions."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Overall Score" value={`${data.overallScore}/100`} tone={data.overallScore >= 70 ? "success" : data.overallScore >= 40 ? "warning" : "destructive"} />
        <StatCard label="Total Views" value={data.totalViews.toLocaleString()} icon={<Eye className="h-4 w-4" />} />
        <StatCard label="Total Likes" value={data.totalLikes.toLocaleString()} icon={<ThumbsUp className="h-4 w-4" />} />
        <StatCard label="Engagement Rate" value={`${data.avgEngagementRate}%`} tone={data.avgEngagementRate >= 5 ? "success" : data.avgEngagementRate >= 2 ? "warning" : "destructive"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Score + Recommendations */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Health Score</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <ScoreRing score={data.overallScore} />
            <div className="w-full space-y-2">
              <h4 className="text-sm font-semibold">Recommendations</h4>
              {data.recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <TrendingUp className="mt-0.5 h-3 w-3 shrink-0 text-brand-fuchsia" />
                  <span>{rec}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Top Issues */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Top Issues ({data.topIssues.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.topIssues.length === 0 && (
              <p className="text-sm text-muted-foreground">Koi critical issue nahi mila. Keep posting!</p>
            )}
            {data.topIssues.map((issue, i) => (
              <IssueCard key={i} issue={issue} />
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Platform Breakdown */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.platforms.map((p) => (
          <Card key={p.platform}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[p.platform] }} />
                {PLATFORM_LABELS[p.platform]}
                <span className="ml-auto text-xs text-muted-foreground">Score: {p.score}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Posted</span>
                <span>{p.totalPosted}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avg Views</span>
                <span>{p.avgViews.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Engagement</span>
                <span>{p.avgEngagementRate}%</span>
              </div>
              {p.issues.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {p.issues.slice(0, 3).map((issue, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[11px]">
                      {issue.severity === "critical" ? (
                        <AlertTriangle className="h-3 w-3 text-rose-400" />
                      ) : (
                        <AlertTriangle className="h-3 w-3 text-amber-400" />
                      )}
                      <span className="truncate">{issue.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
