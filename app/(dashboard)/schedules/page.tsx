"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScheduleForm } from "@/components/schedule-form";
import { useToast } from "@/components/ui/toast";
import { LoadingState, EmptyState } from "@/components/ui/states";
import { PLATFORM_LABELS } from "@/lib/constants";
import { Pencil, Plus, Trash2, Clock, Sparkles } from "lucide-react";
import type { Schedule, ScheduleType } from "@prisma/client";

const TYPE_LABEL: Record<ScheduleType, string> = {
  FIXED_TIMES: "Fixed times",
  INTERVAL: "Interval",
  PLATFORM_SPECIFIC: "Platform-specific",
  BEST_TIMES: "Best times (auto)",
};

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    const data = await fetch("/api/schedules").then((r) => r.json());
    setSchedules(data.schedules);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleEnabled = async (s: Schedule) => {
    const res = await fetch(`/api/schedules/${s.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...s,
        enabled: !s.enabled,
        times: (s.times as string[]) ?? [],
        platforms: (s.platforms as string[]) ?? [],
        scheduleType: s.scheduleType,
        postsPerDay: s.postsPerDay,
        timezone: s.timezone,
        intervalHours: s.intervalHours ?? undefined,
        platformTimes: (s.platformTimes as Record<string, string[]> | null) ?? undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ title: "Failed to update", description: data.error, variant: "error" });
      return;
    }
    load();
  };

  const remove = async (s: Schedule) => {
    if (!confirm(`Delete schedule "${s.name}"?`)) return;
    const res = await fetch(`/api/schedules/${s.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast({ title: "Failed to delete", variant: "error" });
      return;
    }
    toast({ title: "Schedule deleted", variant: "info" });
    load();
  };

  if (!schedules) return <LoadingState />;

  return (
    <div>
      <PageHeader title="Schedules" description="When and how often your videos are published." />
      <div className="mb-4 flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> New schedule
        </Button>
      </div>

      {schedules.length === 0 ? (
        <EmptyState
          title="No schedules yet"
          description="Create a schedule to define your daily posting times and platforms."
          action={
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" /> Create schedule
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {schedules.map((s) => (
            <Card key={s.id} className="transition-all duration-200 hover:border-brand-violet/30 hover:shadow-glow">
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{s.name}</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {TYPE_LABEL[s.scheduleType]} · {s.postsPerDay} posts/day · {s.timezone}
                  </p>
                </div>
                <Badge variant={s.enabled ? "success" : "secondary"}>{s.enabled ? "Enabled" : "Disabled"}</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {s.scheduleType === "FIXED_TIMES" && (
                  <div className="flex flex-wrap gap-1.5">
                    {(s.times as string[]).map((t) => (
                      <span key={t} className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs font-medium">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {s.scheduleType === "INTERVAL" && (
                  <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4 text-brand-fuchsia" />
                    {s.postsPerDay} posts per day, min {s.intervalHours}h apart.
                  </div>
                )}
                {s.scheduleType === "PLATFORM_SPECIFIC" && (
                  <div className="space-y-1.5">
                    {Object.entries((s.platformTimes as Record<string, string[]>) ?? {}).map(([p, times]) => (
                      <div key={p} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{PLATFORM_LABELS[p as keyof typeof PLATFORM_LABELS]}:</span>
                        <span>{times.join(", ")}</span>
                      </div>
                    ))}
                  </div>
                )}
                {s.scheduleType === "BEST_TIMES" && (
                  <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-muted-foreground">
                    <Sparkles className="h-4 w-4 text-brand-amber" />
                    Auto-picks each platform's peak audience times. {s.postsPerDay} posts per day.
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
                  {(s.platforms as string[]).map((p) => (
                    <Badge key={p} variant="outline">
                      {PLATFORM_LABELS[p as keyof typeof PLATFORM_LABELS]}
                    </Badge>
                  ))}
                  <div className="ml-auto flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing(s);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleEnabled(s)}>
                      {s.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(s)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ScheduleForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={load}
        existing={editing}
        key={editing?.id ?? "new"}
      />
    </div>
  );
}