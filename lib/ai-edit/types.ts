import type { EditSpec, SfxType } from "@/lib/editor-spec";

/** How strongly the AI edits a video. */
export type AiEditIntensity = "subtle" | "smart" | "aggressive";

/** User-facing actions (each maps to a targeted edit plan). */
export type AiEditAction =
  | "auto"
  | "re-edit"
  | "cinematic"
  | "viral"
  | "clean"
  | "fast"
  | "emotional"
  | "professional"
  | "improve-audio"
  | "improve-color"
  | "improve-hook"
  | "improve-captions"
  | "improve-ending"
  | "create-loop";

/** Content classification used to drive editing decisions. */
export type VideoType =
  | "talking-head"
  | "action"
  | "motivational"
  | "emotional"
  | "tutorial"
  | "comedy"
  | "generic";

/** Signal-level facts measured from the actual file with ffmpeg. */
export interface SignalAnalysis {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  orientation: "portrait" | "landscape" | "square";
  hasAudio: boolean;
  /** Silence gaps (seconds). */
  silence: { start: number; end: number }[];
  /** Speech windows (complement of silence). */
  speech: { start: number; end: number }[];
  /** Timestamps of detected scene changes. */
  sceneChanges: number[];
  /** Black frames. */
  black: { start: number; end: number }[];
  /** Mean luma 0..1 from sampled frames. */
  brightness: number;
  /** Rough speech/energy fraction of the timeline (0..1). */
  voiceDensity: number;
  /** Loudness measured with loudnorm (null when no audio). */
  loudness: { inputI: number; inputTp: number; inputLra: number } | null;
  /** 0..1 — how similar the first frame is to the last (loop potential). */
  loopScore: number;
  /** Number of duplicate/frozen frames detected. */
  frozenFrames: number;
  /** Scene changes per second (camera/action intensity). */
  cutRate: number;
}

/** One explainable change the AI made, with the reason. */
export interface EditChange {
  what: string;
  why: string;
  category:
    | "hook"
    | "cuts"
    | "pacing"
    | "audio"
    | "sfx"
    | "color"
    | "captions"
    | "music"
    | "ending"
    | "loop"
    | "cleanup"
    | "quality"
    | "motion";
}

/** 0-100 sub-scores (internal optimization metric, not a views prediction). */
export interface AiScore {
  hook: number;
  visual: number;
  audio: number;
  pacing: number;
  captions: number;
  retention: number;
  loop: number;
  overall: number;
}

/** Full result of an AI edit run. */
export interface AiEditPlan {
  videoType: VideoType;
  intensity: AiEditIntensity;
  action: AiEditAction;
  summary: string;
  changes: EditChange[];
  score: AiScore;
  spec: EditSpec;
  /** Tracks actually used for the music bed (license-safe). */
  musicTrack: string | null;
  /** Internal notes: analysis facts that drove the plan. */
  analysisNotes: string[];
  revisions: number;
  /** True when the opening was re-timed to the strongest moment. */
  hookRetimed: boolean;
  /** True when a seamless loop was applied. */
  looped: boolean;
  /** Sfx placed (type @ time). */
  sfxUsed: { type: SfxType; at: number }[];
}

export interface AiEditOptions {
  workspaceId: string;
  driveFileId: string;
  fileName: string;
  hookText: string;
  durationMs?: number | null;
  action: AiEditAction;
  intensity: AiEditIntensity;
  currentSpec?: EditSpec | null;
  /** Vision analysis (from lib/ai) when AI is configured. */
  aiAnalysis?: { topic: string; audience: string; visualNotes: string; style: string; hook: string } | null;
  /** Hard cap for preview renders (seconds). */
  maxSeconds?: number;
  revisionLimit?: number;
  onStage?: (stage: string, label: string, pct?: number) => void;
}

export interface AiEditResult {
  plan: AiEditPlan;
  preview: { filePath: string } | null;
}