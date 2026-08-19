"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  FILTER_PRESETS,
  FILTER_PRESET_LABELS,
  EFFECT_LABELS,
  TEXT_ANIMATION_LABELS,
  defaultEditSpec,
  type EditSpec,
  type EffectKey,
  type FilterPresetKey,
  type TextAnimation,
} from "@/lib/editor-spec";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { AiEditPanel } from "@/components/ai-edit-panel";
import { cn } from "@/lib/utils";
import {
  MOTION_STYLE_DESCRIPTIONS,
  MOTION_STYLE_LABELS,
  defaultMotionSpec,
  type MotionDesignResult,
  type MotionIntensity,
  type MotionSpec,
  type MotionStyleKey,
} from "@/lib/motion/types";
import { Loader2, ArrowLeft, Save, Play, Sparkles, Trash2, Plus, Wand2 } from "lucide-react";

interface EditorData {
  video: {
    id: string;
    fileName: string;
    title: string | null;
    durationMs: number | null;
    width: number | null;
    height: number | null;
    status: string;
  };
  editSpec: EditSpec | null;
  music: string[];
  bgRemovalAvailable: boolean;
}

interface RenderStage {
  stage: string;
  label: string;
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

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const [videoId, setVideoId] = useState<string | null>(null);
  const [data, setData] = useState<EditorData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spec, setSpec] = useState<EditSpec | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<
    "filters" | "effects" | "text" | "music" | "background" | "ai" | "motion"
  >("filters");

  const [rendering, setRendering] = useState(false);
  const [renderStage, setRenderStage] = useState<RenderStage | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [aiStage, setAiStage] = useState<string | null>(null);
  const playerRef = useRef<HTMLVideoElement | null>(null);

  const toast = useToast();

  useEffect(() => {
    params.then((p) => {
      setVideoId(p.id);
      fetch(`/api/videos/${p.id}/edit`)
        .then((r) => r.json())
        .then((d: EditorData & { error?: string }) => {
          if (!d.video) throw new Error(d.error ?? "Failed to load");
          setData(d);
          setSpec(d.editSpec ?? defaultEditSpec());
        })
        .catch((e) => setError((e as Error).message));
    });
  }, [params]);

  const update = useCallback((patch: Partial<EditSpec>) => {
    setSpec((prev) => ({ ...(prev ?? defaultEditSpec()), ...patch }));
    setDirty(true);
  }, []);

  const save = async () => {
    if (!data || !spec) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/videos/${data.video.id}/edit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spec),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed to save");
      setDirty(false);
      toast({ title: "Saved", description: "Edit settings saved. They apply on the next publish." });
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const render = async () => {
    if (!data || !spec || rendering) return;
    setRendering(true);
    setRenderStage({ stage: "download", label: "Downloading video from Drive…" });
    setRenderUrl(null);
    try {
      const res = await fetch(`/api/videos/${data.video.id}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editSpec: spec }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Render failed");
      }
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let sentinelAt = -1;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        if (sentinelAt < 0) {
          const full = concatBytes(chunks);
          sentinelAt = findSentinel(full);
          if (sentinelAt >= 0) break;
        }
      }
      // Drain the rest (binary payload).
      const binary: Uint8Array[] = [];
      let drain = true;
      while (drain) {
        const { done, value } = await reader.read();
        if (done) break;
        binary.push(value);
      }
      const full = concatBytes(chunks);
      const sentinelIdx = findSentinel(full);
      if (sentinelIdx < 0) throw new Error("Render stream was malformed");
      const ssePart = new TextDecoder().decode(full.slice(0, sentinelIdx));
      const binPart = concatBytes([...binary, full.slice(sentinelIdx + SENTINEL.length)]);
      let stageSeen = false;
      for (const frame of ssePart.split("\n\n")) {
        const line = frame.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.type === "stage") {
          stageSeen = true;
          setRenderStage({ stage: ev.stage, label: ev.label ?? "Processing…" });
        } else if (ev.type === "error") {
          throw new Error(ev.error ?? "Render failed");
        }
      }
      if (!stageSeen && binPart.length === 0) throw new Error("Render produced no output");
      if (binPart.length === 0) throw new Error("Render produced an empty file");
      const blob = new Blob([binPart as unknown as BlobPart], { type: "video/mp4" });
      setRenderUrl(URL.createObjectURL(blob));
      toast({ title: "Render complete", description: "Your preview is ready below." });
    } catch (err) {
      toast({ title: "Render failed", description: (err as Error).message, variant: "error" });
    } finally {
      setRendering(false);
    }
  };

  const durationSec = (data?.video.durationMs ?? 0) / 1000 || 60;
  const trimStart = spec?.trim?.start ?? 0;
  const trimEnd = spec?.trim?.end ?? durationSec;
  const trimmedLen = Math.max(0.5, trimEnd - trimStart);

  if (error) {
    return (
      <div>
        <PageHeader title="Video editor" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }
  if (!data || !spec) return <LoadingState />;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Link href="/queue" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to queue
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={save} disabled={saving || !dirty}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {dirty ? "Save changes" : "Saved"}
          </Button>
          <Button onClick={render} disabled={rendering}>
            {rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {rendering ? "Rendering…" : "Render preview"}
          </Button>
        </div>
      </div>

      <PageHeader title="Video editor" description={data.video.fileName} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,480px)_1fr]">
        {/* Preview + timeline */}
        <div className="space-y-4">
          <EditorPreview
            videoId={data.video.id}
            spec={spec}
            currentTime={currentTime}
            onTime={setCurrentTime}
            playerRef={playerRef}
          />
          <TrimTimeline
            durationSec={durationSec}
            trimStart={trimStart}
            trimEnd={trimEnd}
            currentTime={currentTime}
            onSeek={(t) => playerRef.current && (playerRef.current.currentTime = t)}
            onChange={(start, end) => update({ trim: { start, end: end >= durationSec ? null : end } })}
          />
        </div>

        {/* Control panels */}
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1 rounded-lg border p-1">
{(
                [
                  ["filters", "Filters"],
                  ["effects", "Effects"],
                  ["text", "Text & motion"],
                  ["motion", "Motion FX"],
                  ["music", "Music"],
                  ["background", "Background"],
                  ["ai", "AI Edit"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium",
                    tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

          {tab === "filters" && <FiltersPanel spec={spec} update={update} />}
          {tab === "effects" && <EffectsPanel spec={spec} update={update} />}
          {tab === "text" && <TextPanel spec={spec} update={update} durationSec={trimmedLen} />}
          {tab === "music" && <MusicPanel spec={spec} update={update} tracks={data.music} />}
          {tab === "background" && (
            <BackgroundPanel spec={spec} update={update} bgRemovalAvailable={data.bgRemovalAvailable} />
          )}
          {tab === "motion" && <MotionPanel spec={spec} update={update} videoId={data.video.id} />}
          {tab === "ai" && (
            <AiEditPanel
              videoId={data.video.id}
              onStage={setAiStage}
              onPlanApplied={(newSpec, blobUrl) => {
                setSpec(newSpec);
                setDirty(true);
                if (blobUrl) setRenderUrl(blobUrl);
              }}
            />
          )}
        </div>
      </div>

      {/* Render result */}
      {renderUrl && !rendering && (
        <div className="mt-8">
          <h2 className="mb-2 text-lg font-semibold">Preview result</h2>
          <video src={renderUrl} controls className="aspect-[9/16] max-h-[70vh] rounded-lg border bg-black" />
        </div>
      )}

      {/* AI edit progress overlay */}
      {aiStage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-xl">
            <div className="flex flex-col items-center gap-4 text-center">
              <Sparkles className="h-12 w-12 animate-pulse text-primary" />
              <p className="text-lg font-semibold">AI editing…</p>
              <p className="text-sm text-muted-foreground">{aiStage}</p>
              <p className="text-xs text-muted-foreground">
                The engine analyzes, plans, renders and quality-checks the edit. This can take a minute or two.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Rendering progress overlay */}
      {rendering && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border bg-card p-8 shadow-xl">
            <div className="flex flex-col items-center gap-4 text-center">
              <Loader2 className="h-14 w-14 animate-spin text-primary" />
              <p className="text-lg font-semibold">Rendering preview…</p>
              <p className="text-sm text-muted-foreground">{renderStage?.label}</p>
              <p className="text-xs text-muted-foreground">
                {renderStage?.stage === "bg-removal"
                  ? "AI person cut-out runs frame-by-frame — this can take a couple of minutes."
                  : "This can take a minute depending on video length and effects."}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
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

/** Renders caption text with emphasized keywords in the accent color. */
function EmphasisText({ text, emphasis }: { text: string; emphasis: string[] }) {
  if (!emphasis.length) return <>{text}</>;
  const escaped = emphasis
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        emphasis.some((w) => w.toLowerCase() === part.toLowerCase()) ? (
          <span key={i} className="text-[#FFD60A]">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Preview player with live CSS approximation of filters/effects/texts.
// ---------------------------------------------------------------------------

function EditorPreview({
  videoId,
  spec,
  currentTime,
  onTime,
  playerRef,
}: {
  videoId: string;
  spec: EditSpec;
  currentTime: number;
  onTime: (t: number) => void;
  playerRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const cssFilter = buildCssFilter(spec);
  const effectAnim = buildEffectAnimation(spec);

  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-lg border bg-black">
      <video
        ref={playerRef}
        src={`/api/videos/${videoId}/stream`}
        controls
        playsInline
        className="h-full w-full object-contain"
        style={{ filter: cssFilter, ...effectAnim }}
        onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => onTime(e.currentTarget.currentTime)}
      />
      {/* Text overlays (live preview) */}
      {(spec.texts ?? []).map((t) => {
        const start = t.startSec ?? 0;
        const end = t.endSec ?? Number.MAX_SAFE_INTEGER;
        if (currentTime < start || currentTime > end) return null;
        const animClass =
          t.animation === "fade-in"
            ? "editor-anim-fade"
            : t.animation === "slide-up"
              ? "editor-anim-slide"
              : t.animation === "pop"
                ? "editor-anim-pop"
                : "";
        return (
          <div
            key={t.id}
            className={cn("pointer-events-none absolute left-0 right-0 z-10 px-4 text-center", animClass)}
            style={{
              top: `${t.y}%`,
              fontSize: `${(t.fontSize / 10.8).toFixed(2)}cqw`,
              color: t.color,
              textShadow: `0 2px 0 ${t.strokeColor}, 0 0 6px ${t.strokeColor}`,
              fontWeight: 700,
              lineHeight: 1.2,
            }}
          >
            <EmphasisText text={t.text} emphasis={t.emphasis ?? []} />
          </div>
        );
      })}
      {/* Progress bar preview */}
      {spec.progressBar && (
        <div className="absolute bottom-0 left-0 right-0 z-10 h-[1.8%] min-h-[8px] bg-[#FF2D55]">
          <div
            className="h-full bg-[#FF2D55]"
            style={{ width: "100%", opacity: 1 }}
          />
        </div>
      )}
      {/* Vignette approximation */}
      {spec.customFilter && spec.customFilter.vignette > 0 && (
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{ boxShadow: `inset 0 0 ${40 + spec.customFilter.vignette * 140}px rgba(0,0,0,${0.35 + spec.customFilter.vignette * 0.5})` }}
        />
      )}
      <style>{`
        .editor-anim-fade { animation: editorFade 0.5s ease-out both; }
        .editor-anim-slide { animation: editorSlide 0.35s ease-out both; }
        .editor-anim-pop { animation: editorPop 0.3s cubic-bezier(0.34,1.56,0.64,1) both; }
        @keyframes editorFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes editorSlide { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes editorPop { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
}

function buildCssFilter(spec: EditSpec): string {
  const parts: string[] = [];
  const preset = spec.filter && spec.filter !== "none" ? PRESET_CSS[spec.filter] : [];
  parts.push(...preset);
  const cf = spec.customFilter;
  if (cf) {
    if (cf.brightness !== 0) parts.push(`brightness(${1 + cf.brightness * 0.5})`);
    if (cf.contrast !== 0) parts.push(`contrast(${1 + cf.contrast * 0.5})`);
    if (cf.saturation !== 0) parts.push(`saturate(${1 + cf.saturation})`);
    if (cf.hue !== 0) parts.push(`hue-rotate(${cf.hue}deg)`);
    if (cf.blur > 0) parts.push(`blur(${cf.blur * 0.7}px)`);
  }
  return parts.join(" ") || "none";
}

const PRESET_CSS: Record<string, string[]> = {
  vivid: ["saturate(1.45)", "contrast(1.12)", "brightness(1.01)"],
  noir: ["saturate(0)", "contrast(1.25)"],
  vintage: ["sepia(0.35)", "saturate(0.85)", "contrast(1.05)"],
  warm: ["sepia(0.12)", "saturate(1.12)"],
  cool: ["hue-rotate(5deg)", "saturate(1.05)"],
  cinematic: ["contrast(1.18)", "brightness(0.97)", "saturate(1.22)"],
  dreamy: ["blur(0.6px)", "saturate(1.15)", "brightness(1.02)"],
};

function buildEffectAnimation(spec: EditSpec): React.CSSProperties {
  const e = spec.effects ?? [];
  if (e.includes("shake")) {
    return { animation: "editorShake 0.9s linear infinite" };
  }
  if (e.includes("bounce")) {
    return { animation: "editorBounce 1.1s ease-in-out infinite" };
  }
  if (e.includes("zoom-intro")) {
    return { animation: "editorZoom 2.5s ease-out both" };
  }
  if (e.includes("ken-burns")) {
    return { animation: "editorKenBurns 30s ease-in-out infinite alternate" };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Trim timeline
// ---------------------------------------------------------------------------

function TrimTimeline({
  durationSec,
  trimStart,
  trimEnd,
  currentTime,
  onSeek,
  onChange,
}: {
  durationSec: number;
  trimStart: number;
  trimEnd: number;
  currentTime: number;
  onSeek: (t: number) => void;
  onChange: (start: number, end: number) => void;
}) {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>Timeline ({fmt(durationSec)})</span>
        <span className="font-medium text-foreground">
          {fmt(trimStart)} → {fmt(trimEnd)} · {fmt(trimEnd - trimStart)} selected
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={durationSec}
        step={0.05}
        value={currentTime}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="w-full"
        aria-label="Playback position"
      />
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Start trim (seconds)</Label>
          <input
            type="range"
            min={0}
            max={Math.max(0.5, trimEnd - 0.5)}
            step={0.05}
            value={Math.min(trimStart, Math.max(0, trimEnd - 0.5))}
            onChange={(e) => onChange(Math.min(Number(e.target.value), trimEnd - 0.5), trimEnd)}
            className="w-full"
          />
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              max={durationSec}
              step={0.1}
              value={Number(trimStart.toFixed(1))}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!isNaN(v)) onChange(Math.max(0, Math.min(v, trimEnd - 0.5)), trimEnd);
              }}
              className="h-8"
            />
            <span className="text-xs text-muted-foreground">s</span>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">End trim (seconds)</Label>
          <input
            type="range"
            min={Math.min(trimStart + 0.5, durationSec)}
            max={durationSec}
            step={0.05}
            value={trimEnd}
            onChange={(e) => onChange(trimStart, Math.max(Number(e.target.value), trimStart + 0.5))}
            className="w-full"
          />
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              max={durationSec}
              step={0.1}
              value={Number(trimEnd.toFixed(1))}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!isNaN(v)) onChange(trimStart, Math.min(durationSec, Math.max(v, trimStart + 0.5)));
              }}
              className="h-8"
            />
            <span className="text-xs text-muted-foreground">s</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function PanelCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function FiltersPanel({ spec, update }: { spec: EditSpec; update: (p: Partial<EditSpec>) => void }) {
  const cf = spec.customFilter ?? defaultEditSpec().customFilter!;
  const set = (patch: Partial<typeof cf>) => update({ customFilter: { ...cf, ...patch } });
  return (
    <div className="space-y-4">
      <PanelCard title="Filter presets">
        <div className="grid grid-cols-4 gap-2">
          {(Object.keys(FILTER_PRESETS) as FilterPresetKey[]).map((key) => (
            <button
              key={key}
              onClick={() => update({ filter: key })}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-xs transition-colors",
                spec.filter === key ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"
              )}
            >
              <div
                className="h-10 w-10 rounded-md bg-gradient-to-br from-sky-400 via-rose-400 to-amber-300"
                style={{ filter: buildCssFilter({ ...spec, filter: key }) }}
              />
              {FILTER_PRESET_LABELS[key]}
            </button>
          ))}
        </div>
      </PanelCard>
      <PanelCard title="Fine-tune">
        {(
          [
            ["brightness", "Brightness", -1, 1, 0.05],
            ["contrast", "Contrast", -1, 1, 0.05],
            ["saturation", "Saturation", -1, 1, 0.05],
            ["hue", "Hue", -180, 180, 5],
            ["vignette", "Vignette", 0, 1, 0.05],
            ["blur", "Blur", 0, 8, 0.5],
          ] as const
        ).map(([key, label, min, max, step]) => (
          <div key={key} className="mb-3">
            <div className="mb-1 flex justify-between text-xs">
              <span>{label}</span>
              <span className="text-muted-foreground">{cf[key]}</span>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={cf[key]}
              onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<typeof cf>)}
              className="w-full"
            />
          </div>
        ))}
      </PanelCard>
    </div>
  );
}

function EffectsPanel({ spec, update }: { spec: EditSpec; update: (p: Partial<EditSpec>) => void }) {
  const effects = spec.effects ?? [];
  const toggle = (key: EffectKey) => {
    const next = effects.includes(key) ? effects.filter((e) => e !== key) : [...effects, key];
    update({ effects: next });
  };
  return (
    <div className="space-y-4">
      <PanelCard title="Motion effects">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(EFFECT_LABELS) as EffectKey[]).map((key) => (
            <button
              key={key}
              onClick={() => toggle(key)}
              className={cn(
                "rounded-lg border p-3 text-sm transition-colors",
                effects.includes(key) ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"
              )}
            >
              {EFFECT_LABELS[key]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Zoom intro: gentle zoom over the first 2.5s · Slow zoom: constant drift · Shake / bounce: subtle camera-style motion.
        </p>
      </PanelCard>
      <PanelCard title="Motion graphics">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Progress bar</p>
            <p className="text-xs text-muted-foreground">Accent bar grows along the bottom edge.</p>
          </div>
          <Switch checked={spec.progressBar === true} onCheckedChange={(v) => update({ progressBar: v })} />
        </div>
      </PanelCard>
    </div>
  );
}

function TextPanel({
  spec,
  update,
  durationSec,
}: {
  spec: EditSpec;
  update: (p: Partial<EditSpec>) => void;
  durationSec: number;
}) {
  const texts = spec.texts ?? [];
  const setText = (id: string, patch: Partial<(typeof texts)[number]>) => {
    update({ texts: texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  };
  const addText = () => {
    const id = `t-${Date.now().toString(36)}`;
    update({
      texts: [
        ...texts,
        {
          id,
          text: "New text",
          fontSize: 54,
          color: "#ffffff",
          strokeColor: "#000000",
          y: 50,
          animation: "fade-in" as TextAnimation,
          startSec: 0,
          endSec: Math.min(3, durationSec),
        },
      ],
    });
  };
  const removeText = (id: string) => update({ texts: texts.filter((t) => t.id !== id) });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Text overlays render over the video with animations.</p>
        <Button size="sm" onClick={addText}>
          <Plus className="h-3.5 w-3.5" />
          Add text
        </Button>
      </div>
      {texts.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No text overlays. The AI hook title is shown automatically; add your own for more punch.
        </p>
      )}
      {texts.map((t) => (
        <div key={t.id} className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Overlay</span>
            <Button variant="ghost" size="icon" onClick={() => removeText(t.id)} aria-label="Remove text">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Text</Label>
            <Input value={t.text} onChange={(e) => setText(t.id, { text: e.target.value })} maxLength={80} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Size</Label>
              <Input
                type="number"
                min={24}
                max={96}
                value={t.fontSize}
                onChange={(e) => setText(t.id, { fontSize: Number(e.target.value) || 54 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Vertical position</Label>
              <Input
                type="number"
                min={5}
                max={95}
                value={t.y}
                onChange={(e) => setText(t.id, { y: Number(e.target.value) || 50 })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={t.color}
                  onChange={(e) => setText(t.id, { color: e.target.value })}
                  className="h-9 w-12 cursor-pointer rounded border border-input bg-transparent"
                />
                <span className="text-xs text-muted-foreground">{t.color}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Animation</Label>
              <select
                value={t.animation}
                onChange={(e) => setText(t.id, { animation: e.target.value as TextAnimation })}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              >
                {(Object.keys(TEXT_ANIMATION_LABELS) as TextAnimation[]).map((k) => (
                  <option key={k} value={k}>
                    {TEXT_ANIMATION_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Start (s)</Label>
              <Input
                type="number"
                min={0}
                step={0.1}
                value={t.startSec ?? 0}
                onChange={(e) => setText(t.id, { startSec: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">End (s, 0 = end)</Label>
              <Input
                type="number"
                min={0}
                step={0.1}
                value={t.endSec ?? 0}
                onChange={(e) => setText(t.id, { endSec: Number(e.target.value) > 0 ? Number(e.target.value) : null })}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MusicPanel({
  spec,
  update,
  tracks,
}: {
  spec: EditSpec;
  update: (p: Partial<EditSpec>) => void;
  tracks: string[];
}) {
  const music = spec.music;
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const pick = (track: string | null) => {
    update({ music: { track, volume: music?.volume ?? 0.22, fadeInSec: music?.fadeInSec ?? 1, fadeOutSec: music?.fadeOutSec ?? 2 } });
  };
  const setVol = (volume: number) => update({ music: { track: music?.track ?? null, volume, fadeInSec: music?.fadeInSec ?? 1, fadeOutSec: music?.fadeOutSec ?? 2 } });
  const setFade = (key: "fadeInSec" | "fadeOutSec", v: number) =>
    update({ music: { track: music?.track ?? null, volume: music?.volume ?? 0.22, fadeInSec: key === "fadeInSec" ? v : music?.fadeInSec ?? 1, fadeOutSec: key === "fadeOutSec" ? v : music?.fadeOutSec ?? 2 } });

  const togglePreview = (track: string) => {
    if (previewing === track) {
      audioRef.current?.pause();
      setPreviewing(null);
      return;
    }
    setPreviewing(track);
    const audio = new Audio(`/api/music/${encodeURIComponent(track)}`);
    audioRef.current = audio;
    audio.play().catch(() => setPreviewing(null));
    audio.onended = () => setPreviewing(null);
  };

  return (
    <div className="space-y-4">
      <PanelCard title="Background music">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => pick(null)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm",
              !music?.track ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"
            )}
          >
            No music
          </button>
          {tracks.map((t) => (
            <div
              key={t}
              className={cn(
                "flex items-center gap-1 rounded-md border px-2 py-1 text-sm",
                music?.track === t ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"
              )}
            >
              <button onClick={() => pick(t)}>{t.replace(/\.(mp3|m4a|wav|ogg)$/i, "")}</button>
              <button
                onClick={() => togglePreview(t)}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label={`Preview ${t}`}
              >
                {previewing === t ? <span className="text-[10px] font-bold">STOP</span> : <Play className="h-3 w-3" />}
              </button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">CC0 tracks from the music folder — no copyright issues.</p>
      </PanelCard>
      <PanelCard title="Mix">
        <div className="mb-3">
          <div className="mb-1 flex justify-between text-xs">
            <span>Music volume</span>
            <span className="text-muted-foreground">{Math.round((music?.volume ?? 0.22) * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={music?.volume ?? 0.22}
            onChange={(e) => setVol(Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div className="mb-3">
          <div className="mb-1 flex justify-between text-xs">
            <span>Fade in (s)</span>
            <span className="text-muted-foreground">{music?.fadeInSec ?? 1}s</span>
          </div>
          <input
            type="range"
            min={0}
            max={5}
            step={0.5}
            value={music?.fadeInSec ?? 1}
            onChange={(e) => setFade("fadeInSec", Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span>Fade out (s)</span>
            <span className="text-muted-foreground">{music?.fadeOutSec ?? 2}s</span>
          </div>
          <input
            type="range"
            min={0}
            max={5}
            step={0.5}
            value={music?.fadeOutSec ?? 2}
            onChange={(e) => setFade("fadeOutSec", Number(e.target.value))}
            className="w-full"
          />
        </div>
      </PanelCard>
    </div>
  );
}

function BackgroundPanel({
  spec,
  update,
  bgRemovalAvailable,
}: {
  spec: EditSpec;
  update: (p: Partial<EditSpec>) => void;
  bgRemovalAvailable: boolean;
}) {
  const bg = spec.background;
  const set = (patch: Partial<NonNullable<typeof bg>>) => update({ background: { ...(bg ?? defaultEditSpec().background!), ...patch } });
  return (
    <div className="space-y-4">
      <PanelCard title="Remove background (AI)">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Real person cut-out</p>
            <p className="text-xs text-muted-foreground">
              Detects the person frame-by-frame with a neural network and removes everything behind them.
            </p>
          </div>
          <Switch
            checked={bg?.remove === true}
            onCheckedChange={(v) => set({ remove: v })}
            disabled={!bgRemovalAvailable}
          />
        </div>
        {!bgRemovalAvailable && (
          <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700">
            Background removal model not found. It will be downloaded automatically on first use (15 MB).
          </p>
        )}
        {bg?.remove && (
          <>
            <div className="mt-3 space-y-1">
              <Label className="text-xs">Background style</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => set({ style: "blur" })}
                  className={cn(
                    "rounded-lg border p-3 text-sm",
                    bg.style === "blur" ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"
                  )}
                >
                  Blurred original
                </button>
                <button
                  onClick={() => set({ style: "color" })}
                  className={cn(
                    "rounded-lg border p-3 text-sm",
                    bg.style === "color" ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"
                  )}
                >
                  Solid color
                </button>
              </div>
            </div>
            {bg.style === "blur" ? (
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs">
                  <span>Blur strength</span>
                  <span className="text-muted-foreground">{bg.blurAmount}</span>
                </div>
                <input
                  type="range"
                  min={4}
                  max={60}
                  step={1}
                  value={bg.blurAmount ?? 40}
                  onChange={(e) => set({ blurAmount: Number(e.target.value) })}
                  className="w-full"
                />
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2">
                <Label className="text-xs">Color</Label>
                <input
                  type="color"
                  value={bg.color ?? "#111827"}
                  onChange={(e) => set({ color: e.target.value })}
                  className="h-9 w-14 cursor-pointer rounded border border-input bg-transparent"
                />
                <span className="text-xs text-muted-foreground">{bg.color ?? "#111827"}</span>
              </div>
            )}
          </>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Background removal runs at render/publish time and can take a minute or two — it processes every frame.
        </p>
      </PanelCard>
    </div>
  );
}

interface MotionDesignResponse extends MotionDesignResult {
  analysis: {
    beats: number[];
    bpm: number;
    confident: boolean;
    musicDriven: boolean;
    subjectAvailable: boolean;
    subjectSamples: number;
    motionAvg: number;
  };
}

function MotionPanel({
  spec,
  update,
  videoId,
}: {
  spec: EditSpec;
  update: (p: Partial<EditSpec>) => void;
  videoId: string;
}) {
  const toast = useToast();
  const [designing, setDesigning] = useState(false);
  const [motionStage, setMotionStage] = useState<string | null>(null);
  const [designResult, setDesignResult] = useState<MotionDesignResponse | null>(null);

  const motion = spec.motion ?? null;
  const enabled = motion?.enabled === true;

  const setMotion = (patch: Partial<MotionSpec>) =>
    update({ motion: motion ? { ...motion, ...patch } : { ...defaultMotionSpec(), ...patch } });

  const generateDesign = async () => {
    setDesigning(true);
    setMotionStage("Starting…");
    setDesignResult(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/motion-design`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoType: "generic",
          intensity: (motion?.intensity as MotionIntensity | undefined) ?? "smart",
          style: (motion?.style as MotionStyleKey | undefined) ?? null,
          texts: (spec.texts ?? []).map((t) => ({ id: t.id, text: t.text, startSec: t.startSec ?? 0 })),
        }),
      });
      if (!res.ok || !res.body) throw new Error("Could not start the motion design.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          const line = ev.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const obj = JSON.parse(line.slice(6)) as Record<string, unknown>;
          if (obj.type === "stage") {
            setMotionStage(obj.label as string);
          } else if (obj.type === "design") {
            const d = obj.design as MotionDesignResponse;
            setDesignResult(d);
            setMotion({ ...d.spec, enabled: true });
          } else if (obj.type === "error") {
            throw new Error(obj.error as string);
          }
        }
      }
      if (!designResult) toast({ title: "Design ready", description: "Motion design applied — enable it and render a preview." });
    } catch (err) {
      toast({ title: "Design failed", description: (err as Error).message, variant: "error" });
    } finally {
      setDesigning(false);
      setMotionStage(null);
    }
  };

  const motionChips: string[] = [];
  if (enabled && motion) {
    if (motion.camera.length) motionChips.push(`${motion.camera.length} camera keys`);
    if (motion.beats.length) motionChips.push(`${motion.beats.length} beat pulses`);
    if (motion.punchIn) motionChips.push("punch-in");
    if (motion.shake.at.length) motionChips.push("impact shake");
    if (motion.speedRamps.length) motionChips.push(`${motion.speedRamps.length} speed ramp${motion.speedRamps.length > 1 ? "s" : ""}`);
    if (motion.transitions?.xfade) motionChips.push("xfade transitions");
    if (motion.trails > 1) motionChips.push(`trails ×${motion.trails}`);
    if (motion.parallax > 0) motionChips.push("parallax depth");
    if (motion.overlays.letterbox) motionChips.push("letterbox");
    if (motion.overlays.glow) motionChips.push("glow");
    if (motion.overlays.rays) motionChips.push("light rays");
    if (motion.overlays.particles) motionChips.push("particles");
    if (motion.overlays.vignette > 0) motionChips.push("vignette");
    if (motion.overlays.grain > 0) motionChips.push("grain");
    const t3d = Object.values(motion.text3d);
    if (t3d.length) {
      motionChips.push(
        `${t3d.length} 3D text${t3d.some((t) => t.kinetic) ? " (kinetic)" : ""}${t3d.some((t) => t.follow) ? " (follow)" : ""}`
      );
    }
  }

  return (
    <div className="space-y-4">
      <PanelCard title="AI Motion Graphics & Effects">
        <p className="text-xs text-muted-foreground">
          The engine analyzes your clip — music beats, motion energy and the subject — then designs a purposeful
          camera, 3D kinetic text, transitions, overlays and synced SFX. Nothing random: every element serves hook,
          pacing or impact.
        </p>
        <div className="mt-3 flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Motion graphics engine</p>
            <p className="text-xs text-muted-foreground">
              Default style: Modern + Cinematic + High Retention + Clean 3D Motion Graphics
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => update({ motion: motion ? { ...motion, enabled: v } : { ...defaultMotionSpec(), enabled: v } })}
          />
        </div>
      </PanelCard>

      {enabled && (
        <PanelCard title="Style & intensity">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(MOTION_STYLE_LABELS) as MotionStyleKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setMotion({ style: k })}
                className={cn(
                  "rounded-lg border p-2 text-left transition-colors",
                  motion?.style === k ? "border-primary bg-primary/10" : "hover:bg-accent"
                )}
              >
                <p className="text-xs font-semibold">{MOTION_STYLE_LABELS[k]}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{MOTION_STYLE_DESCRIPTIONS[k]}</p>
              </button>
            ))}
          </div>
          <div className="mt-3 space-y-1">
            <Label className="text-xs">Intensity</Label>
            <div className="flex gap-1">
              {(["subtle", "smart", "aggressive"] as const).map((i) => (
                <button
                  key={i}
                  onClick={() => setMotion({ intensity: i })}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-1.5 text-xs font-medium capitalize",
                    motion?.intensity === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>
          <Button
            onClick={generateDesign}
            disabled={designing}
            className="mt-4 w-full"
          >
            {designing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            {designing ? motionStage ?? "Designing…" : "Generate AI motion design"}
          </Button>
          {(motion?.style ?? "modern-cinematic") !== "modern-cinematic" && (
            <p className="mt-2 text-[11px] text-muted-foreground">Regenerate after changing style or intensity to apply it.</p>
          )}
        </PanelCard>
      )}

      {enabled && motion && motionChips.length > 0 && (
        <PanelCard title="Applied design">
          <div className="flex flex-wrap gap-1.5">
            {motionChips.map((c) => (
              <span key={c} className="rounded-full border bg-accent/50 px-2.5 py-1 text-[11px]">
                {c}
              </span>
            ))}
          </div>
          {designResult && (
            <>
              <div className="mt-3 space-y-2">
                {designResult.changes.map((c, i) => (
                  <div key={i} className="rounded-md border p-2.5">
                    <p className="text-xs font-medium">{c.what}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{c.why}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-md border p-2.5 text-[11px] text-muted-foreground">
                {designResult.analysis.confident
                  ? `${designResult.analysis.beats.length} beats at ${designResult.analysis.bpm} BPM`
                  : "No clear beat grid — effects use timing instead of rhythm."}
                {designResult.analysis.subjectAvailable
                  ? ` · subject tracked (${designResult.analysis.subjectSamples} samples)`
                  : " · no subject detected — text stays in place"}
              </div>
            </>
          )}
        </PanelCard>
      )}

      {enabled && (!spec.texts || spec.texts.length === 0) && (
        <PanelCard title="No text yet">
          <p className="text-xs text-muted-foreground">
            Add a caption or hook in the “Text & motion” tab — the engine turns each text into an animated 3D
            element (entrance, tilt, kinetic reveal, subject-follow).
          </p>
        </PanelCard>
      )}
    </div>
  );
}