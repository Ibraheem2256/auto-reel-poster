"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { LoadingState } from "@/components/ui/states";
import { cn, formatDateTime } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface CalendarPost {
  id: string;
  scheduledAt: string;
  status: string;
  video: { fileName: string; thumbnailUrl: string | null };
  jobs: { platform: string; status: string }[];
}

export default function CalendarPage() {
  const [posts, setPosts] = useState<CalendarPost[] | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  useEffect(() => {
    fetch("/api/posts?pageSize=50")
      .then((r) => r.json())
      .then((d) => setPosts(d.posts))
      .catch(() => setPosts([]));
  }, []);

  const days = useMemo(() => {
    const first = new Date(month.year, month.month, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();
    const cells: (number | null)[] = Array(startDay).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [month]);

  const postsByDay = useMemo(() => {
    const map: Record<string, CalendarPost[]> = {};
    for (const p of posts ?? []) {
      const d = new Date(p.scheduledAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      (map[key] ??= []).push(p);
    }
    return map;
  }, [posts, month]);

  const shiftMonth = (delta: number) => {
    setMonth((m) => {
      const d = new Date(m.year, m.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  const monthLabel = new Date(month.year, month.month, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <PageHeader title="Calendar" description="Your publishing schedule." />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => shiftMonth(-1)} className="rounded-md border p-2 hover:bg-accent" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="min-w-40 text-center text-lg font-semibold">{monthLabel}</h2>
          <button onClick={() => shiftMonth(1)} className="rounded-md border p-2 hover:bg-accent" aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Published</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" /> Scheduled</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" /> Failed</span>
        </div>
      </div>

      {!posts ? (
        <div className="mt-4"><LoadingState /></div>
      ) : (
        <div className="mt-4 grid grid-cols-7 gap-1.5">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="pb-1 text-center text-xs font-medium uppercase text-muted-foreground">
              {d}
            </div>
          ))}
          {days.map((day, i) => {
            const key = day ? `${month.year}-${month.month}-${day}` : null;
            const dayPosts = key ? (postsByDay[key] ?? []) : [];
            const statuses = dayPosts.map((p) => p.status);
            const hasFailed = statuses.includes("FAILED");
            const hasPublished = statuses.includes("PUBLISHED");
            const isToday =
              day === new Date().getDate() &&
              month.month === new Date().getMonth() &&
              month.year === new Date().getFullYear();
            return (
              <div
                key={i}
                className={cn(
                  "min-h-24 rounded-md border p-1.5",
                  day ? "bg-card" : "bg-transparent",
                  isToday && "border-primary ring-1 ring-primary"
                )}
              >
                {day && (
                  <>
                    <span className="text-xs font-semibold text-muted-foreground">{day}</span>
                    <div className="mt-1 space-y-1">
                      {dayPosts.slice(0, 3).map((p) => (
                        <Link
                          key={p.id}
                          href={`/posts/${p.id}`}
                          className={cn(
                            "block truncate rounded px-1.5 py-0.5 text-[10px] font-medium",
                            p.status === "PUBLISHED" && "bg-emerald-500/15 text-emerald-700",
                            p.status === "FAILED" && "bg-destructive/15 text-destructive",
                            p.status === "SCHEDULED" && "bg-sky-500/15 text-sky-700"
                          )}
                        >
                          {p.video.fileName.slice(0, 18)}
                        </Link>
                      ))}
                      {dayPosts.length > 3 && (
                        <span className="block px-1 text-[10px] text-muted-foreground">+{dayPosts.length - 3} more</span>
                      )}
                      {hasFailed && !dayPosts.some((p) => p.status === "PUBLISHED") && (
                        <span className="block px-1 text-[10px] font-medium text-destructive">Failed</span>
                      )}
                      {hasPublished && <span className="block px-1 text-[10px] font-medium text-emerald-600">Published</span>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">Times shown in UTC. Configure your timezone in Settings.</p>
    </div>
  );
}