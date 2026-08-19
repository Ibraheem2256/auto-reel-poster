"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VideoStatusBadge } from "@/components/status-badges";
import { PlatformIcon } from "@/components/platform-icons";
import { EmptyState, StatCardSkeleton, Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/utils";
import { PLATFORM_LABELS } from "@/lib/constants";
import {
  Zap,
  FolderOpen,
  Link2,
  Clock,
  ArrowRight,
  ListVideo,
  CalendarDays,
  Send,
  AlertTriangle,
  Users,
  Check,
  ChevronRight,
  Sparkles,
} from "lucide-react";

interface DashboardData {
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
  byPlatform: { platform: string; status: string; _count: { _all: number } }[];
  setup: {
    driveConnected: boolean;
    schedules: number;
    automationEnabled: boolean;
    paused: boolean;
  };
}

interface QueueItem {
  id: string;
  fileName: string;
  title: string | null;
  thumbnailUrl: string | null;
  status: string;
  detectedAt: string;
  scheduledPost: { scheduledAt: string } | null;
  platformJobs: { id: string; platform: string; status: string }[];
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [userName, setUserName] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/analytics").then((r) => r.json()),
      fetch("/api/videos/queue").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()).catch(() => null),
    ])
      .then(([d, q, s]) => {
        setData(d);
        setQueue(q.queue ?? []);
        setUserName(s?.user?.name ?? null);
        setMounted(true);
      })
      .catch(() => setError("Failed to load dashboard data."));
  }, []);

  if (error) return <div className="text-sm text-destructive">{error}</div>;
  if (!data)
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-xl border border-white/[0.06] bg-card/70 p-6 backdrop-blur-xl">
            <Skeleton className="h-5 w-40 mb-4" />
            <div className="flex h-36 items-end gap-3">
              {[60, 45, 75, 30, 55, 40, 65].map((h, i) => (
                <div key={i} className="flex flex-1 items-end" style={{ height: `${h}%` }}>
                  <Skeleton className="h-full w-full rounded-t-lg" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-card/70 p-6 backdrop-blur-xl">
            <Skeleton className="h-5 w-32 mb-4" />
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );

  const maxDay = Math.max(1, ...Object.values(data.byDay));
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // Setup checklist state
  const setup = data.setup;
  const steps = [
    {
      key: "drive",
      title: "Connect your Drive folder",
      description: "Point us at the folder where your reels live",
      href: "/drive",
      done: setup.driveConnected,
      icon: FolderOpen,
    },
    {
      key: "accounts",
      title: "Connect social accounts",
      description: "Link TikTok, YouTube, Instagram and Facebook",
      href: "/accounts",
      done: data.stats.accounts > 0,
      icon: Link2,
    },
    {
      key: "schedule",
      title: "Create a posting schedule",
      description: "Choose how many videos to post per day",
      href: "/schedules",
      done: setup.schedules > 0,
      icon: Clock,
    },
    {
      key: "automation",
      title: "Enable automation",
      description: "Let the bot publish on your behalf",
      href: "/settings",
      done: setup.automationEnabled,
      icon: Zap,
    },
  ];
  const doneSteps = steps.filter((s) => s.done).length;
  const allSetUp = doneSteps === steps.length;

  // Platform health from byPlatform
  const platforms = ["TIKTOK", "YOUTUBE", "INSTAGRAM", "FACEBOOK"] as const;
  const platformHealth = platforms.map((p) => {
    const rows = data.byPlatform.filter((r) => r.platform === p);
    const total = rows.reduce((sum, r) => sum + r._count._all, 0);
    const success = rows.find((r) => r.status === "SUCCESS")?._count._all ?? 0;
    const failed = rows.find((r) => r.status === "FAILED")?._count._all ?? 0;
    const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
    return { platform: p, total, success, failed, successRate };
  });

  const nextScheduled = queue
    .filter((v) => v.scheduledPost?.scheduledAt)
    .sort(
      (a, b) =>
        new Date(a.scheduledPost!.scheduledAt).getTime() - new Date(b.scheduledPost!.scheduledAt).getTime()
    )[0];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between animate-fade-in-up">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-fuchsia/80">
            {today}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">
            {greeting()}
            {userName ? (
              <>
                , <span className="text-gradient">{userName.split(" ")[0]}</span>
              </>
            ) : null}
            <span className="text-muted-foreground"> 👋</span>
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {allSetUp
              ? "Your reels pipeline is live. Here's what's happening today."
              : "A few quick steps and your reels will publish themselves."}
          </p>
        </div>
        {setup.automationEnabled && (
          <div
            className={`inline-flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-xs font-semibold ${
              setup.paused
                ? "border-amber-400/30 bg-amber-500/10 text-amber-300"
                : "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            <span className="relative flex h-2 w-2">
              {!setup.paused && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              )}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${setup.paused ? "bg-amber-400" : "bg-emerald-400"}`} />
            </span>
            {setup.paused ? "Auto posting paused" : "Auto posting live"}
          </div>
        )}
      </div>

      {/* Setup checklist */}
      {!allSetUp && (
        <Card className="animate-fade-in-up">
          <CardContent className="p-5">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand-fuchsia" />
                <p className="font-display text-sm font-semibold">Set up your pipeline</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {doneSteps} of {steps.length} steps complete
              </p>
            </div>
            <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-animated transition-all duration-700"
                style={{ width: `${(doneSteps / steps.length) * 100}%` }}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step) => (
                <Link
                  key={step.key}
                  href={step.href}
                  className={`group relative flex flex-col gap-1.5 rounded-xl border p-3 transition-all duration-200 ${
                    step.done
                      ? "border-emerald-400/15 bg-emerald-500/5"
                      : "border-white/[0.06] bg-white/[0.02] hover:border-brand-violet/40 hover:bg-brand-violet/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                        step.done
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-gradient-to-br from-brand-violet/25 to-brand-fuchsia/15 text-brand-fuchsia"
                      }`}
                    >
                      {step.done ? <Check className="h-4 w-4" /> : <step.icon className="h-4 w-4" />}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-brand-fuchsia" />
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${step.done ? "text-emerald-300/80" : ""}`}>
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Videos in Queue" value={data.stats.videosInQueue} icon={<ListVideo className="h-3.5 w-3.5" />} />
        <StatCard label="Scheduled Today" value={data.stats.scheduledToday} icon={<CalendarDays className="h-3.5 w-3.5" />} />
        <StatCard label="Posted Today" value={data.stats.postedToday} tone="success" icon={<Send className="h-3.5 w-3.5" />} />
        <StatCard label="Total Posted" value={data.stats.totalPosted} tone="success" icon={<Zap className="h-3.5 w-3.5" />} />
        <StatCard
          label="Failed Jobs"
          value={data.stats.failedJobs}
          tone={data.stats.failedJobs > 0 ? "destructive" : "default"}
          hint={data.stats.failedJobs > 0 ? "Retries active" : undefined}
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
        />
        <StatCard label="Accounts" value={data.stats.accounts} icon={<Users className="h-3.5 w-3.5" />} />
      </div>

      {/* Chart + platform health */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Posts — last 7 days</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Cross-platform publish volume</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              <Zap className="h-3 w-3 text-brand-fuchsia" />
              {Object.values(data.byDay).reduce((a, b) => a + b, 0)} this week
            </span>
          </CardHeader>
          <CardContent>
            {Object.entries(data.byDay).length === 0 ? (
              <p className="text-sm text-muted-foreground">No posts yet.</p>
            ) : (
              <div className="flex h-36 items-end gap-2 sm:gap-3">
                {Object.entries(data.byDay).map(([day, count], i) => {
                  const pct = (count / maxDay) * 100;
                  const date = new Date(`${day}T00:00:00Z`);
                  return (
                    <div key={day} className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                      <span className="text-xs font-semibold text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                        {count}
                      </span>
                      <div className="relative flex w-full flex-1 items-end">
                        <div
                          className={`w-full rounded-t-lg bg-gradient-to-t from-brand-violet/70 via-brand-fuchsia/60 to-brand-amber/50 transition-all duration-700 ease-out group-hover:from-brand-violet group-hover:via-brand-fuchsia group-hover:to-brand-amber ${
                            count > 0 ? "shadow-glow" : "opacity-20"
                          }`}
                          style={{
                            height: mounted ? `${Math.max(count > 0 ? 6 : 3, pct * 0.9)}%` : "0%",
                            transitionDelay: `${i * 60}ms`,
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {DAY_LABELS[date.getUTCDay()]}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Platform health</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">Publish results per network</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {platformHealth.every((p) => p.total === 0) ? (
              <p className="text-sm text-muted-foreground">
                No posts yet. Connect accounts to see per-platform results.
              </p>
            ) : (
              platformHealth.map((p) => (
                <div key={p.platform} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <PlatformIcon platform={p.platform as never} className="h-4 w-4 text-[8px]" />
                      {PLATFORM_LABELS[p.platform as keyof typeof PLATFORM_LABELS]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      <span className="font-semibold text-emerald-400">{p.success}</span>
                      <span className="mx-1">/</span>
                      {p.total}
                      {p.failed > 0 && (
                        <span className="ml-1.5 font-semibold text-rose-400">({p.failed} failed)</span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        p.failed > 0
                          ? "bg-gradient-to-r from-emerald-400/80 to-emerald-400/40"
                          : "bg-gradient-to-r from-emerald-400 to-emerald-300"
                      }`}
                      style={{ width: `${p.successRate}%` }}
                    />
                  </div>
                </div>
              ))
            )}
            {platformHealth.some((p) => p.failed > 0) && (
              <Link
                href="/posts"
                className="flex items-center gap-1.5 text-xs font-semibold text-amber-300 transition-colors hover:text-amber-200"
              >
                <AlertTriangle className="h-3 w-3" />
                Some posts failed — review them
              </Link>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Queue + quick actions */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Next up</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {nextScheduled
                  ? `Next post in ${formatRelative(nextScheduled.scheduledPost!.scheduledAt)}`
                  : "Your content pipeline"}
              </p>
            </div>
            <Link
              href="/queue"
              className="group inline-flex items-center gap-1 text-xs font-semibold text-brand-fuchsia transition-colors hover:text-brand-violet"
            >
              View queue
              <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {queue.length === 0 ? (
              <EmptyState
                icon={<ListVideo className="h-5 w-5" />}
                title="Queue is empty"
                description="Connect a Drive folder and enable automation to fill it with your reels."
                action={
                  <Link href="/drive">
                    <Button size="sm">
                      <FolderOpen className="h-4 w-4" /> Connect Drive folder
                    </Button>
                  </Link>
                }
              />
            ) : (
              queue.slice(0, 5).map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 transition-all duration-200 hover:border-brand-violet/30 hover:bg-brand-violet/5"
                >
                  {v.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/videos/${v.id}/thumbnail`}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-10 w-10 rounded-md object-cover ring-1 ring-white/10"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gradient-to-br from-brand-violet/20 to-brand-fuchsia/20 text-[10px] font-semibold text-brand-fuchsia">
                      VID
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{v.title || v.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {v.scheduledPost?.scheduledAt
                        ? `Publishing ${formatRelative(v.scheduledPost.scheduledAt)}`
                        : `Detected ${formatRelative(v.detectedAt)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {v.platformJobs.map((j) => (
                      <PlatformIcon key={j.id} platform={j.platform as never} />
                    ))}
                  </div>
                  <VideoStatusBadge status={v.status as never} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <CardTitle className="text-base">Quick actions</CardTitle>
            <div className="mt-3 space-y-2">
              <Link
                href="/drive"
                className="group flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 transition-all duration-200 hover:border-brand-violet/30 hover:bg-brand-violet/5"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-violet/25 to-brand-fuchsia/15 text-brand-violet transition-colors group-hover:text-brand-fuchsia">
                  <FolderOpen className="h-4 w-4" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-medium">Drive Folder</span>
                  <span className="block text-xs text-muted-foreground">
                    {setup.driveConnected ? "Manage your source folder" : "Connect your reels folder"}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-brand-fuchsia" />
              </Link>
              <Link
                href="/accounts"
                className="group flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 transition-all duration-200 hover:border-brand-violet/30 hover:bg-brand-violet/5"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-violet/25 to-brand-fuchsia/15 text-brand-violet transition-colors group-hover:text-brand-fuchsia">
                  <Link2 className="h-4 w-4" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-medium">Connected Accounts</span>
                  <span className="block text-xs text-muted-foreground">
                    {data.stats.accounts} of 4 platforms connected
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-brand-fuchsia" />
              </Link>
              <Link
                href="/schedules"
                className="group flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 transition-all duration-200 hover:border-brand-violet/30 hover:bg-brand-violet/5"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-violet/25 to-brand-fuchsia/15 text-brand-violet transition-colors group-hover:text-brand-fuchsia">
                  <Clock className="h-4 w-4" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-medium">Schedules</span>
                  <span className="block text-xs text-muted-foreground">
                    {setup.schedules > 0 ? `${setup.schedules} active schedule` : "Set daily posting times"}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-brand-fuchsia" />
              </Link>
            </div>
          </Card>
          <div className="rounded-xl border border-white/[0.06] bg-gradient-to-br from-brand-violet/10 via-brand-fuchsia/5 to-transparent p-5">
            <p className="font-display text-sm font-semibold">Zero video storage</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Your videos stream straight from Google Drive to the platforms — nothing is stored, nothing is lost.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}