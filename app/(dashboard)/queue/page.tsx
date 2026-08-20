"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { VideoStatusBadge, JobStatusBadge } from "@/components/status-badges";
import { PlatformBadge } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { LoadingState, EmptyState, TableSkeleton } from "@/components/ui/states";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent, DialogFooter, DialogCloseButton } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { formatRelative, formatBytes, formatDuration } from "@/lib/utils";
import { Zap, Loader2, PencilLine, CheckCircle2, XCircle, SlidersHorizontal, CalendarClock, Trash2 } from "lucide-react";

function Countdown({ target }: { target: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = new Date(target).getTime() - now;
  if (diff <= 0) return <span className="text-green-500 font-medium">Publishing now...</span>;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return <span className="text-brand-fuchsia font-medium tabular-nums">{parts.join(" ")}</span>;
}

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const QUICK_PICKS = [
  { label: "In 1 hour", get: () => new Date(Date.now() + 3_600_000) },
  {
    label: "Tonight 8 PM",
    get: () => {
      const d = new Date();
      d.setHours(20, 0, 0, 0);
      return d;
    },
  },
  {
    label: "Tomorrow 9 AM",
    get: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
];

interface QueueVideo {
  id: string;
  fileName: string;
  title: string | null;
  thumbnailUrl: string | null;
  fileSize: string;
  durationLabel: string;
  status: string;
  detectedAt: string;
  invalidReason?: string | null;
  driveSource?: { folderName: string | null } | null;
  scheduledPost?: { scheduledAt: string } | null;
  platformJobs?: { id: string; platform: string; status: string }[];
}

interface ContentDraft {
  title: string;
  caption: string;
  hashtags: string[];
  description: string;
  aiGenerated: boolean;
}

interface PublishStage {
  stage: string;
  label: string;
}

interface PublishDone {
  ok: boolean;
  results?: { platform: string; status: string }[];
  error?: string;
}

export default function QueuePage() {
  const [queue, setQueue] = useState<QueueVideo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);

  // Review & edit dialog state.
  const [reviewVideo, setReviewVideo] = useState<QueueVideo | null>(null);
  const [draft, setDraft] = useState<ContentDraft | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Full-screen progress overlay state.
  const [progress, setProgress] = useState<PublishStage | null>(null);
  const [progressDone, setProgressDone] = useState<PublishDone | null>(null);

  // Schedule dialog state.
  const [scheduleVideo, setScheduleVideo] = useState<QueueVideo | null>(null);
  const [scheduleValue, setScheduleValue] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [unscheduling, setUnscheduling] = useState(false);

  const toast = useToast();

  const loadQueue = () =>
    fetch("/api/videos/queue")
      .then((r) => r.json())
      .then((d) => setQueue(d.queue))
      .catch(() => setError("Failed to load the queue."));

  useEffect(() => {
    loadQueue();
    // AI titles generate in the background — re-check once a few seconds later.
    const t = setTimeout(loadQueue, 6000);
    return () => clearTimeout(t);
  }, []);

  const openReview = async (video: QueueVideo) => {
    setReviewVideo(video);
    setDraft(null);
    setLoadingContent(true);
    try {
      const res = await fetch(`/api/videos/${video.id}/content`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate content");
      setDraft({
        title: data.title ?? "",
        caption: data.caption ?? "",
        hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
        description: data.description ?? "",
        aiGenerated: Boolean(data.aiGenerated),
      });
    } catch (err) {
      toast({ title: "Failed to generate content", description: (err as Error).message, variant: "error" });
      setReviewVideo(null);
    } finally {
      setLoadingContent(false);
    }
  };

  const openSchedule = (video: QueueVideo) => {
    setScheduleVideo(video);
    setScheduleValue(
      video.scheduledPost?.scheduledAt
        ? toLocalInputValue(new Date(video.scheduledPost.scheduledAt))
        : toLocalInputValue(new Date(Date.now() + 3_600_000))
    );
    setScheduling(false);
    setUnscheduling(false);
  };

  const saveSchedule = async () => {
    if (!scheduleVideo) return;
    const date = new Date(scheduleValue);
    if (isNaN(date.getTime())) {
      toast({ title: "Invalid time", description: "Pick a date and time for the post.", variant: "error" });
      return;
    }
    setScheduling(true);
    try {
      const res = await fetch(`/api/videos/${scheduleVideo.id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: date.toISOString() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to schedule");
      toast({
        title: scheduleVideo.scheduledPost ? "Post rescheduled" : "Post scheduled",
        description: `Publishing ${formatRelative(data.scheduledAt)} to ${data.platforms.length} platform${data.platforms.length === 1 ? "" : "s"}.`,
        variant: "success",
      });
      setScheduleVideo(null);
      loadQueue();
    } catch (err) {
      toast({ title: "Failed to schedule", description: (err as Error).message, variant: "error" });
    } finally {
      setScheduling(false);
    }
  };

  const unschedule = async () => {
    if (!scheduleVideo) return;
    setUnscheduling(true);
    try {
      const res = await fetch(`/api/videos/${scheduleVideo.id}/schedule`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove schedule");
      toast({ title: "Schedule removed", description: "The video is back in the queue.", variant: "success" });
      setScheduleVideo(null);
      loadQueue();
    } catch (err) {
      toast({ title: "Failed to remove schedule", description: (err as Error).message, variant: "error" });
    } finally {
      setUnscheduling(false);
    }
  };

  const postNow = async () => {
    if (!reviewVideo || !draft) return;
    setPublishing(true);
    setProgress({ stage: "start", label: "Starting…" });
    setProgressDone(null);
    try {
      // SSE: read the streaming response as it progresses.
      const res = await fetch(`/api/videos/${reviewVideo.id}/publish-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          caption: draft.caption,
          description: draft.description,
          hashtags: draft.hashtags,
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to post");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let doneEvent: PublishDone | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by blank lines.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame
            .split("\n")
            .find((l) => l.startsWith("data: "))
            ?.slice(6);
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === "stage") {
            setProgress({ stage: event.stage, label: event.label ?? "Processing…" });
          } else if (event.type === "result") {
            doneEvent = { ok: true, results: event.results };
          } else if (event.type === "error") {
            doneEvent = { ok: false, error: event.error ?? "Failed to post" };
          }
        }
      }
      if (!doneEvent) {
        const remaining = buffer
          .split("\n")
          .find((l) => l.startsWith("data: "))
          ?.slice(6);
        if (remaining) {
          const event = JSON.parse(remaining);
          if (event.type === "result") doneEvent = { ok: true, results: event.results };
          else if (event.type === "error") doneEvent = { ok: false, error: event.error ?? "Failed to post" };
        }
      }
      setProgressDone(doneEvent);
      setReviewVideo(null);
      loadQueue();
    } catch (err) {
      setProgressDone({ ok: false, error: (err as Error).message });
    } finally {
      setPublishing(false);
    }
  };

  const hashtagsText = draft?.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ") ?? "";

  const setHashtagsFromText = (text: string) => {
    if (!draft) return;
    const tags = text
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#/, "").trim())
      .filter(Boolean);
    setDraft({ ...draft, hashtags: tags });
  };

  return (
    <div>
      <PageHeader title="Content Queue" description="Videos detected from your Drive folder and their publishing status." />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!queue ? (
        <TableSkeleton rows={5} />
      ) : queue.length === 0 ? (
        <EmptyState
          title="Queue is empty"
          description="Connect a Google Drive folder and enable automation. New videos will be detected automatically."
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Video</th>
                  <th className="px-4 py-3 font-medium">Drive</th>
                  <th className="px-4 py-3 font-medium">Detected</th>
                  <th className="px-4 py-3 font-medium">Scheduled</th>
                  <th className="px-4 py-3 font-medium">Platforms</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {queue.map((v) => (
                  <tr key={v.id} className="hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {v.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/videos/${v.id}/thumbnail`}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-11 w-11 rounded object-cover ring-1 ring-white/10"
                          />
                        ) : (
                          <div className="flex h-11 w-11 items-center justify-center rounded bg-gradient-to-br from-brand-violet/20 to-brand-fuchsia/20 text-[10px] font-semibold text-brand-fuchsia">VID</div>
                        )}
                        <div className="min-w-0">
                          <p className="max-w-[220px] truncate font-medium">{v.title || v.fileName}</p>
                          <p className="text-xs text-muted-foreground">
                            {v.title ? v.fileName : "Generating title…"} · {v.fileSize} · {v.durationLabel}
                          </p>
                          {v.invalidReason && <p className="mt-0.5 max-w-[260px] truncate text-xs text-destructive">{v.invalidReason}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{v.driveSource?.folderName ?? "-"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatRelative(v.detectedAt)}</td>
                    <td className="px-4 py-3">
                      {v.scheduledPost?.scheduledAt ? (
                        <div className="flex flex-col gap-0.5">
                          <Countdown target={v.scheduledPost.scheduledAt} />
                          <span className="text-[10px] text-muted-foreground">{formatRelative(v.scheduledPost.scheduledAt)}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {v.platformJobs?.map((j) => (
                          <span key={j.id} className="flex flex-col items-start gap-0.5">
                            <PlatformBadge platform={j.platform as never} />
                            <JobStatusBadge status={j.status as never} />
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <VideoStatusBadge status={v.status as never} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/editor/${v.id}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-xs font-medium transition-colors hover:bg-accent"
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                          Edit
                        </Link>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openSchedule(v)}
                          disabled={!!postingId}
                          title={v.scheduledPost?.scheduledAt ? "Change the scheduled time" : "Pick your own publishing time"}
                        >
                          <CalendarClock className="h-3.5 w-3.5" />
                          {v.scheduledPost?.scheduledAt ? "Reschedule" : "Schedule"}
                        </Button>
                        <Button size="sm" onClick={() => openReview(v)} disabled={postingId === v.id || !!postingId}>
                          <PencilLine className="h-3.5 w-3.5" />
                          Post now
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {queue.map((v) => (
              <div
                key={v.id}
                className="rounded-xl border border-white/[0.06] bg-card/70 p-4 backdrop-blur-xl transition-all duration-200 hover:border-brand-violet/30"
              >
                <div className="flex items-start gap-3">
                  {v.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/videos/${v.id}/thumbnail`}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-14 w-14 rounded-lg object-cover ring-1 ring-white/10"
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-gradient-to-br from-brand-violet/20 to-brand-fuchsia/20 text-xs font-semibold text-brand-fuchsia">VID</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{v.title || v.fileName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {v.fileSize} · {v.durationLabel}
                    </p>
                    {v.invalidReason && <p className="mt-0.5 text-xs text-destructive">{v.invalidReason}</p>}
                  </div>
                  <VideoStatusBadge status={v.status as never} />
                </div>

                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatRelative(v.detectedAt)}</span>
                  {v.scheduledPost?.scheduledAt && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <Countdown target={v.scheduledPost.scheduledAt} />
                    </>
                  )}
                </div>

                {v.platformJobs && v.platformJobs.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {v.platformJobs.map((j) => (
                      <span key={j.id} className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px]">
                        <PlatformBadge platform={j.platform as never} />
                        <JobStatusBadge status={j.status as never} />
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex gap-2">
                  <Link
                    href={`/editor/${v.id}`}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] py-2 text-xs font-medium transition-colors hover:border-brand-violet/40 hover:bg-brand-violet/5"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Edit
                  </Link>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => openSchedule(v)}
                    disabled={!!postingId}
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                    Schedule
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => openReview(v)}
                    disabled={postingId === v.id || !!postingId}
                  >
                    <PencilLine className="h-3.5 w-3.5" />
                    Post
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={!!scheduleVideo} onOpenChange={(o) => !o && !scheduling && setScheduleVideo(null)}>
        <DialogHeader>
          <DialogTitle>{scheduleVideo?.scheduledPost ? "Reschedule post" : "Schedule post"}</DialogTitle>
          <DialogDescription>
            {scheduleVideo?.fileName} — pick your own publishing time.
          </DialogDescription>
          <DialogCloseButton onClick={() => !scheduling && setScheduleVideo(null)} />
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="schedule-time">Date & time</Label>
              <Input
                id="schedule-time"
                type="datetime-local"
                value={scheduleValue}
                min={toLocalInputValue(new Date(Date.now() + 60_000))}
                onChange={(e) => setScheduleValue(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Quick picks</Label>
              <div className="flex flex-wrap gap-2">
                {QUICK_PICKS.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => setScheduleValue(toLocalInputValue(q.get()))}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-brand-violet/50 hover:text-brand-fuchsia"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-muted-foreground">
              {scheduleVideo?.scheduledPost ? (
                <p>
                  Currently scheduled for{" "}
                  <span className="font-medium text-foreground">
                    {formatRelative(scheduleVideo.scheduledPost.scheduledAt)}
                  </span>
                  . Saving will replace it with the new time.
                </p>
              ) : (
                <p>
                  Posts to every connected platform at the chosen time. Manual schedules post even when
                  automation is off, and respect the global pause.
                </p>
              )}
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          {scheduleVideo?.scheduledPost && (
            <Button
              variant="ghost"
              onClick={unschedule}
              disabled={unscheduling || scheduling}
              className="mr-auto text-muted-foreground hover:text-destructive"
            >
              {unscheduling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {unscheduling ? "Removing…" : "Remove schedule"}
            </Button>
          )}
          <Button variant="outline" onClick={() => setScheduleVideo(null)} disabled={scheduling}>
            Cancel
          </Button>
          <Button onClick={saveSchedule} disabled={scheduling || !scheduleValue}>
            {scheduling ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            {scheduling ? "Saving…" : scheduleVideo?.scheduledPost ? "Reschedule" : "Schedule"}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={!!reviewVideo} onOpenChange={(o) => !o && !publishing && setReviewVideo(null)}>
        <DialogHeader>
          <DialogTitle>Review & publish</DialogTitle>
          <DialogDescription>
            {reviewVideo?.fileName} — generated from the video content. Edit before posting.
          </DialogDescription>
          <DialogCloseButton onClick={() => !publishing && setReviewVideo(null)} />
        </DialogHeader>
        <DialogContent>
          {loadingContent || !draft ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing video and generating content… (takes a few seconds)
            </div>
          ) : (
            <div className="space-y-4">
              {!draft.aiGenerated && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700">
                  <p className="font-semibold">AI generation unavailable</p>
                  <p className="mt-0.5">
                    The AI provider did not return content for this video (no credits or quota exhausted). This is
                    fallback content — edit it manually before posting, or add credits at
                    <span className="font-medium"> openrouter.ai/settings/credits</span>.
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="caption">Caption</Label>
                <Textarea
                  id="caption"
                  rows={4}
                  value={draft.caption}
                  onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
                  maxLength={2200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hashtags">Hashtags</Label>
                <Input
                  id="hashtags"
                  value={hashtagsText}
                  onChange={(e) => setHashtagsFromText(e.target.value)}
                  placeholder="#car #luxury"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description (YouTube)</Label>
                <Textarea
                  id="description"
                  rows={3}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  maxLength={5000}
                />
              </div>
            </div>
          )}
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setReviewVideo(null)} disabled={publishing}>
            Cancel
          </Button>
          <Button onClick={postNow} disabled={loadingContent || !draft || publishing}>
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {publishing ? "Posting…" : "Confirm & post"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Full-screen publishing progress overlay */}
      {(progress || progressDone) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-xl">
            {!progressDone ? (
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="relative h-14 w-14">
                  <Loader2 className="h-14 w-14 animate-spin text-primary" />
                </div>
                <p className="text-lg font-semibold">Publishing {reviewVideo?.fileName}</p>
                <p className="text-sm text-muted-foreground">{progress?.label ?? "Processing…"}</p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {progress?.stage === "edit"
                    ? "This can take a minute — cropping, adding hook, and mixing sound."
                    : "Uploading may take a moment depending on video size."}
                </p>
              </div>
            ) : progressDone.ok ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <CheckCircle2 className="h-12 w-12 text-green-500" />
                <p className="text-lg font-semibold">Posted!</p>
                <div className="w-full space-y-1.5">
                  {(progressDone.results ?? []).map((r) => (
                    <div key={r.platform} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <span>{r.platform}</span>
                      <span className={r.status === "SUCCESS" ? "text-green-500" : "text-red-500"}>{r.status}</span>
                    </div>
                  ))}
                </div>
                <Button className="mt-2" onClick={() => setProgressDone(null)}>
                  Done
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center">
                <XCircle className="h-12 w-12 text-red-500" />
                <p className="text-lg font-semibold">Posting failed</p>
                <p className="text-sm text-muted-foreground">{progressDone.error ?? "Something went wrong."}</p>
                <Button className="mt-2" variant="outline" onClick={() => setProgressDone(null)}>
                  Close
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
