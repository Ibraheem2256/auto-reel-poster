import type { AiScore } from "@/lib/ai-edit/types";

/** Clamp a number to 0..1. */
export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Round to one decimal. */
export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export interface QcIssue {
  severity: "minor" | "major";
  message: string;
}

/**
 * Apply QC penalties to the plan score. The score is an internal
 * optimization metric — never a prediction of views.
 */
export function applyQcPenalty(score: AiScore, issues: QcIssue[]): AiScore {
  if (!issues.length) return score;
  let penalty = 0;
  let audioPenalty = 0;
  let visualPenalty = 0;
  for (const issue of issues) {
    const p = issue.severity === "major" ? 10 : 3;
    penalty += p;
    if (/(clip|loud|audio|music|silence)/i.test(issue.message)) audioPenalty += p;
    if (/(black|freeze|artifact|resolution|loop|jump)/i.test(issue.message)) visualPenalty += p;
  }
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  return {
    hook: clamp(score.hook - penalty * 0.5),
    visual: clamp(score.visual - visualPenalty),
    audio: clamp(score.audio - audioPenalty),
    pacing: clamp(score.pacing - penalty * 0.5),
    captions: clamp(score.captions - penalty * 0.3),
    retention: clamp(score.retention - penalty),
    loop: clamp(score.loop - penalty * 0.7),
    overall: clamp(score.overall - penalty),
  };
}