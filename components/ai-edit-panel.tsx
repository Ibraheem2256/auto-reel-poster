"use client";

import { useRef, useState } from "react";
import { Loader2, Sparkles, Wand2, RotateCcw, Film, Zap, Heart, Briefcase, Mic2, Palette, Captions, Flag, Repeat } from "lucide-react";
import type { EditSpec } from "@/lib/editor-spec";
import type { AiEditAction, AiEditIntensity } from "@/lib/ai-edit/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent, DialogFooter, DialogCloseButton } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface AiPlanResponse {
  videoType: string;
  intensity: string;
  action: string;
  summary: string;
  changes: { what: string; why: string; category: string }[];
  score: {
    hook: number;
    visual: number;
    audio: number;
    pacing: number;
    captions: number;
    retention: number;
    loop: number;
    overall: number;
  };
  analysisNotes: string[];
  revisions: number;
  hookRetimed: boolean;
  looped: boolean;
  sfxUsed: { type: string; at: number }[];
  musicTrack: string | null;
  spec: EditSpec;
  size: number;
}

const SENTINEL = new Uint8Array([0x00, 0x41, 0x52, 0x50, 0x52, 0x45, 0x4e, 0x44, 0x00]);

function findSentinel(buf: Uint8Array): number {
  for (let i = 0; i <= buf.length - SENTINEL.length; i++) {
    let match = true;
    for (let j = 0; j < SENTINEL.length; j++) {
      if (buf[i + j] !== SENTINEL[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

const ACTION_BUTTONS: { action: AiEditAction; label: string; icon: React.ReactNode }[] = [
  { action: "cinematic", label: "Cinematic", icon: <Film className="h-3.5 w-3.5" /> },
  { action: "viral", label: "Viral style", icon: <Zap className="h-3.5 w-3.5" /> },
  { action: "clean", label: "Clean", icon: <Wand2 className="h-3.5 w-3.5" /> },
  { action: "fast", label: "Fast", icon: <Zap className="h-3.5 w-3.5" /> },
  { action: "emotional", label: "Emotional", icon: <Heart className="h-3.5 w-3.5" /> },
  { action: "professional", label: "Professional", icon: <Briefcase className="h-3.5 w-3.5" /> },
  { action: "improve-audio", label: "Improve audio", icon: <Mic2 className="h-3.5 w-3.5" /> },
  { action: "improve-color", label: "Improve color", icon: <Palette className="h-3.5 w-3.5" /> },
  { action: "improve-hook", label: "Improve hook", icon: <Sparkles className="h-3.5 w-3.5" /> },
  { action: "improve-captions", label: "Improve captions", icon: <Captions className="h-3.5 w-3.5" /> },
  { action: "improve-ending", label: "Improve ending", icon: <Flag className="h-3.5 w-3.5" /> },
  { action: "create-loop", label: "Create loop", icon: <Repeat className="h-3.5 w-3.5" /> },
];

const SCORE_LABELS: { key: keyof AiPlanResponse["score"]; label: string }[] = [
  { key: "hook", label: "Hook" },
  { key: "visual", label: "Visual quality" },
  { key: "audio", label: "Audio" },
  { key: "pacing", label: "Pacing" },
  { key: "captions", label: "Captions" },
  { key: "retention", label: "Retention potential" },
  { key: "loop", label: "Loop / replay" },
];

export function AiEditPanel({
  videoId,
  onPlanApplied,
  onStage,
}: {
  videoId: string;
  onPlanApplied: (spec: EditSpec, previewBlobUrl: string | null) => void;
  onStage: (label: string | null) => void;
}) {
  const [intensity, setIntensity] = useState<AiEditIntensity>("smart");
  const [running, setRunning] = useState(false);
  const [showExplain, setShowExplain] = useState(false);
  const [lastPlan, setLastPlan] = useState<AiPlanResponse | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const toast = useToast();

  const run = async (action: AiEditAction) => {
    if (running) return;
    setRunning(true);
    setLastPlan(null);
    onStage("Analyzing your video (silence, scenes, motion, audio)…");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`/api/videos/${videoId}/ai-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, intensity, maxSeconds: 0 }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "AI edit failed");
      }
      // Read the entire response, then split on the sentinel.
      // The sentinel always appears (even on error), so this is safe.
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const full = concatBytes(chunks);
      const sentinelIdx = findSentinel(full);
      if (sentinelIdx < 0) throw new Error("AI edit stream was malformed");
      const ssePart = new TextDecoder().decode(full.slice(0, sentinelIdx));
      const binPart = full.slice(sentinelIdx + SENTINEL.length);

      let plan: AiPlanResponse | null = null;
      let sawStage = false;
      let serverError: string | null = null;
      for (const frame of ssePart.split("\n\n")) {
        const line = frame.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
        if (!line) continue;
        // Only wrap JSON.parse — never swallow intentional error events.
        let ev: { type: string; label?: string; plan?: AiPlanResponse; error?: string };
        try {
          ev = JSON.parse(line);
        } catch {
          // Skip partial / corrupt SSE frames at chunk boundaries.
          continue;
        }
        if (ev.type === "stage") {
          sawStage = true;
          onStage(ev.label ?? "Processing…");
        } else if (ev.type === "plan") {
          plan = ev.plan as AiPlanResponse;
        } else if (ev.type === "error") {
          // Record the server error; throw after the loop so all frames are read.
          serverError = ev.error ?? "AI edit failed";
        }
      }
      if (serverError) throw new Error(serverError);
      if (!plan) throw new Error("AI edit produced no plan");
      setLastPlan(plan);
      const blobUrl = binPart.length
        ? URL.createObjectURL(new Blob([binPart], { type: "video/mp4" }))
        : null;
      onPlanApplied(plan.spec, blobUrl);
      if (!sawStage && !blobUrl) throw new Error("AI edit produced no output");
      toast({
        title: `AI edit complete — score ${plan.score.overall}/100`,
        description: `${plan.changes.length} change${plan.changes.length === 1 ? "" : "s"} applied. Open “AI explain changes” for the reasoning.`,
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast({ title: "AI edit failed", description: (err as Error).message, variant: "error" });
      }
    } finally {
      setRunning(false);
      onStage(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">AI Shorts Post-Production Engine</h3>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          The AI analyzes the actual video (silence, scenes, motion, audio, loop potential), understands what it is, then
          edits it for hook, retention, clarity and emotion — never with random effects.
        </p>

        <div className="mb-3">
          <p className="mb-1.5 text-xs font-medium">Editing intensity</p>
          <div className="grid grid-cols-3 gap-1 rounded-lg border p-1">
            {(
              [
                ["subtle", "Subtle"],
                ["smart", "Smart"],
                ["aggressive", "Aggressive"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setIntensity(key)}
                className={cn(
                  "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                  intensity === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {intensity === "subtle"
              ? "For already-good footage: minimal corrections only."
              : intensity === "smart"
                ? "Default: applies only the improvements the video actually needs."
                : "For weak footage: tighter cuts, stronger pacing, more SFX and text."}
          </p>
        </div>

        <Button onClick={() => run("auto")} disabled={running} className="w-full">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {running ? "AI is editing…" : "Auto Edit"}
        </Button>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Analyzes the video, builds an edit plan, renders a preview, quality-checks it (auto-fixing issues, up to 3
          revisions), then saves the plan for publishing.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold">Targeted edits</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {ACTION_BUTTONS.map(({ action, label, icon }) => (
            <button
              key={action}
              onClick={() => run(action)}
              disabled={running}
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>

      {lastPlan && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Last AI edit</h3>
            <div className="text-sm font-bold text-primary">
              {lastPlan.score.overall}
              <span className="text-xs font-normal text-muted-foreground">/100</span>
            </div>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">{lastPlan.summary}</p>
          <Button variant="outline" size="sm" onClick={() => setShowExplain(true)} disabled={running}>
            <Sparkles className="h-3.5 w-3.5" />
            AI explain changes
          </Button>
          {lastPlan.revisions > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Auto-revised {lastPlan.revisions}× after quality control.
            </p>
          )}
        </div>
      )}

      <Dialog open={showExplain} onOpenChange={setShowExplain}>
        <DialogHeader>
          <DialogTitle>AI explain changes</DialogTitle>
          <DialogDescription>
            Every change is content-aware — here is exactly what was edited and why. The score is an internal quality
            metric, not a views prediction.
          </DialogDescription>
          <DialogCloseButton onClick={() => setShowExplain(false)} />
        </DialogHeader>
        <DialogContent>
          {lastPlan && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                {SCORE_LABELS.map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${lastPlan.score[key]}%` }}
                      />
                    </div>
                    <span className="w-7 text-right font-medium">{lastPlan.score[key]}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                {lastPlan.changes.map((c, i) => (
                  <div key={i} className="rounded-md border p-2.5">
                    <p className="text-xs font-medium">{c.what}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{c.why}</p>
                  </div>
                ))}
                {lastPlan.changes.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nothing to change — the video was already strong.</p>
                )}
              </div>
              {lastPlan.analysisNotes.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Analysis notes
                  </p>
                  <ul className="list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
                    {lastPlan.analysisNotes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowExplain(false)}>
            Close
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}