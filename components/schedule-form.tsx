"use client";

import { useState } from "react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent, DialogFooter, DialogCloseButton } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectItem } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { PLATFORM_LABELS, TIMEZONE_OPTIONS, BEST_TIME_LABELS } from "@/lib/constants";
import { X } from "lucide-react";
import type { Platform, Schedule, ScheduleType } from "@prisma/client";

interface ScheduleFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  existing?: Schedule | null;
}

const DEFAULT_TIMES = ["10:00", "14:00", "19:00"];

export function ScheduleForm({ open, onOpenChange, onSaved, existing }: ScheduleFormProps) {
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? "Default Schedule");
  const [timezone, setTimezone] = useState(existing?.timezone ?? "Asia/Karachi");
  const [scheduleType, setScheduleType] = useState<ScheduleType>(existing?.scheduleType ?? "FIXED_TIMES");
  const [postsPerDay, setPostsPerDay] = useState(existing?.postsPerDay ?? 3);
  const [times, setTimes] = useState<string[]>((existing?.times as string[]) ?? DEFAULT_TIMES);
  const [intervalHours, setIntervalHours] = useState(existing?.intervalHours ?? 4);
  const [platforms, setPlatforms] = useState<Platform[]>((existing?.platforms as Platform[]) ?? ["TIKTOK", "YOUTUBE", "INSTAGRAM", "FACEBOOK"]);
  const [platformTimes, setPlatformTimes] = useState<Record<string, string[]>>(
    (existing?.platformTimes as Record<string, string[]>) ?? { TIKTOK: ["10:00", "16:00", "21:00"], INSTAGRAM: ["11:00", "17:00"], YOUTUBE: ["12:00", "19:00"], FACEBOOK: ["13:00", "20:00"] }
  );
  const [saving, setSaving] = useState(false);

  const addTime = () => setTimes((t) => (t.length >= 24 ? t : [...t, "12:00"]));
  const removeTime = (idx: number) => setTimes((t) => t.filter((_, i) => i !== idx));

  const togglePlatform = (p: Platform) =>
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const save = async () => {
    setSaving(true);
    const payload = {
      name,
      timezone,
      scheduleType,
      postsPerDay,
      times: scheduleType === "INTERVAL" || scheduleType === "BEST_TIMES" ? [] : times,
      intervalHours: scheduleType === "INTERVAL" ? intervalHours : undefined,
      platforms,
      platformTimes: scheduleType === "PLATFORM_SPECIFIC" ? platformTimes : undefined,
      enabled: true,
    };
    try {
      const res = await fetch(existing ? `/api/schedules/${existing.id}` : "/api/schedules", {
        method: existing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save schedule");
      toast({ title: existing ? "Schedule updated" : "Schedule created", variant: "success" });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Failed to save", description: (err as Error).message, variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogCloseButton onClick={() => onOpenChange(false)} />
      <DialogHeader>
        <DialogTitle>{existing ? "Edit schedule" : "New schedule"}</DialogTitle>
        <DialogDescription>Choose how many videos to post each day and when.</DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Schedule name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                {TIMEZONE_OPTIONS.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select value={scheduleType} onValueChange={(v) => setScheduleType(v as ScheduleType)}>
                <SelectItem value="BEST_TIMES">Best times (auto)</SelectItem>
                <SelectItem value="FIXED_TIMES">Fixed times</SelectItem>
                <SelectItem value="INTERVAL">Interval</SelectItem>
                <SelectItem value="PLATFORM_SPECIFIC">Platform-specific</SelectItem>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Posts per day</Label>
            <Input
              type="number"
              min={1}
              max={24}
              value={postsPerDay}
              onChange={(e) => setPostsPerDay(Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
            />
          </div>

          {scheduleType === "BEST_TIMES" && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3">
              <Label className="text-xs">Peak times used automatically (your timezone)</Label>
              <div className="space-y-1">
                {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
                  <p key={p} className="text-xs text-muted-foreground">
                    <span className="font-medium">{PLATFORM_LABELS[p]}:</span>{" "}
                    {BEST_TIME_LABELS[p]}
                  </p>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Each platform posts at its own peak time. Select how many videos to post per day and we handle the rest.
              </p>
            </div>
          )}

          {scheduleType === "FIXED_TIMES" && (
            <div className="space-y-2">
              <Label>Posting times</Label>
              <div className="flex flex-wrap gap-2">
                {times.map((t, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm">
                    <input
                      type="time"
                      value={t}
                      onChange={(e) => setTimes((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                      className="bg-transparent text-sm outline-none"
                    />
                    <button onClick={() => removeTime(i)} aria-label="Remove time">
                      <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </button>
                  </span>
                ))}
              </div>
              {times.length < 24 && (
                <Button type="button" variant="outline" size="sm" onClick={addTime}>
                  + Add time
                </Button>
              )}
            </div>
          )}

          {scheduleType === "INTERVAL" && (
            <div className="space-y-2">
              <Label>Minimum interval (hours)</Label>
              <Input
                type="number"
                min={1}
                max={24}
                value={intervalHours}
                onChange={(e) => setIntervalHours(Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
              />
              <p className="text-xs text-muted-foreground">
                {postsPerDay} posts spread across the day with at least {intervalHours} hours between them.
              </p>
            </div>
          )}

          {scheduleType === "PLATFORM_SPECIFIC" && (
            <div className="space-y-3">
              {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
                <div key={p} className="space-y-1">
                  <Label className="text-xs">{PLATFORM_LABELS[p]}</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {(platformTimes[p] ?? ["10:00"]).map((t, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs">
                        <input
                          type="time"
                          value={t}
                          onChange={(e) =>
                            setPlatformTimes((prev) => ({
                              ...prev,
                              [p]: (prev[p] ?? []).map((x, j) => (j === i ? e.target.value : x)),
                            }))
                          }
                          className="w-20 bg-transparent text-xs outline-none"
                        />
                        <button
                          onClick={() =>
                            setPlatformTimes((prev) => ({ ...prev, [p]: (prev[p] ?? []).filter((_, j) => j !== i) }))
                          }
                          aria-label={`Remove ${p} time`}
                        >
                          <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                        </button>
                      </span>
                    ))}
                    <button
                      onClick={() => setPlatformTimes((prev) => ({ ...prev, [p]: [...(prev[p] ?? []), "12:00"] }))}
                      className="text-xs text-primary"
                    >
                      + add
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label>Platforms</Label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                    platforms.includes(p) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"
                  }`}
                >
                  {PLATFORM_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save schedule"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}