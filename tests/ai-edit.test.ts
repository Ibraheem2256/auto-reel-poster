import { describe, expect, it } from "vitest";
import { normalizeEditSpec, defaultEditSpec } from "@/lib/editor-spec";
import {
  buildEditPlan,
  buildTimeline,
  classifyVideo,
  computeScore,
  mapToFinal,
} from "@/lib/ai-edit/plan";
import { applyQcPenalty } from "@/lib/ai-edit/score";
import { placeCaptions, pickEmphasis } from "@/lib/ai-edit/captions";
import type { SignalAnalysis } from "@/lib/ai-edit/types";

function signal(overrides: Partial<SignalAnalysis> = {}): SignalAnalysis {
  return {
    durationSec: 15,
    width: 1080,
    height: 1920,
    fps: 30,
    orientation: "portrait",
    hasAudio: true,
    silence: [],
    speech: [{ start: 1, end: 14 }],
    sceneChanges: [],
    black: [],
    brightness: 0.5,
    voiceDensity: 0.7,
    loudness: { inputI: -15, inputTp: -2, inputLra: 9 },
    loopScore: 0.7,
    frozenFrames: 0,
    cutRate: 0.2,
    ...overrides,
  };
}

describe("classifyVideo", () => {
  it("classifies talking-head from AI style", () => {
    expect(classifyVideo(signal(), { style: "talking head coaching", topic: "x", audience: "y", visualNotes: "z", hook: "h" })).toBe("talking-head");
  });

  it("classifies action from high cut rate", () => {
    expect(classifyVideo(signal({ cutRate: 2.4, voiceDensity: 0.05 }), null)).toBe("action");
  });

  it("classifies motivational from style", () => {
    expect(classifyVideo(signal(), { style: "motivational quote", topic: "x", audience: "y", visualNotes: "z", hook: "h" })).toBe("motivational");
  });

  it("defaults to talking-head for slow, voice-heavy footage", () => {
    expect(classifyVideo(signal({ cutRate: 0.1 }), null)).toBe("talking-head");
  });
});

describe("timeline mapping", () => {
  it("maps source time to final time after cuts", () => {
    const tl = buildTimeline(
      [{ start: 4, end: 5 }],
      0,
      null,
      10
    );
    expect(tl.finalDuration).toBeCloseTo(9, 5);
    expect(mapToFinal(tl, 2)).toBeCloseTo(2, 5);
    expect(mapToFinal(tl, 4.5)).toBeCloseTo(4, 5);
    expect(mapToFinal(tl, 6)).toBeCloseTo(5, 5);
    expect(mapToFinal(tl, 10)).toBeCloseTo(9, 5);
  });
});

describe("buildEditPlan", () => {
  it("re-times the hook when the opening is dead", async () => {
    const plan = await buildEditPlan({
      signal: signal({
        speech: [{ start: 2.4, end: 14 }],
        silence: [{ start: 0, end: 2.4 }],
      }),
      fileName: "test.mp4",
      hookText: "Hook",
      action: "auto",
      intensity: "smart",
      seed: "s1",
    });
    expect(plan.hookRetimed).toBe(true);
    expect(plan.spec.trim?.start ?? 0).toBeGreaterThan(1.5);
    expect(plan.changes.some((c) => c.category === "hook")).toBe(true);
  });

  it("leaves a strong opening untouched", async () => {
    const plan = await buildEditPlan({
      signal: signal({ speech: [{ start: 0.2, end: 14 }] }),
      fileName: "test.mp4",
      hookText: "Hook",
      action: "auto",
      intensity: "smart",
      seed: "s1",
    });
    expect(plan.hookRetimed).toBe(false);
    expect(plan.spec.trim?.start ?? 0).toBe(0);
  });

  it("cuts dead silence in talking-head footage", async () => {
    const plan = await buildEditPlan({
      signal: signal({
        voiceDensity: 0.6,
        silence: [{ start: 3, end: 4.5 }, { start: 9, end: 10.5 }],
        speech: [{ start: 0.3, end: 3 }, { start: 4.5, end: 9 }, { start: 10.5, end: 15 }],
      }),
      fileName: "talk.mp4",
      hookText: "Title",
      action: "auto",
      intensity: "smart",
      seed: "s1",
    });
    expect(plan.videoType).toBe("talking-head");
    expect(plan.spec.cuts?.length ?? 0).toBeGreaterThan(0);
    expect(plan.spec.texts?.length ?? 0).toBeGreaterThan(0); // captions
  });

  it("applies action treatment for high-motion footage", async () => {
    const plan = await buildEditPlan({
      signal: signal({
        cutRate: 2.0,
        voiceDensity: 0.05,
        sceneChanges: [1.2, 4, 7, 10],
        loopScore: 0.8,
      }),
      fileName: "clips.mp4",
      hookText: "Clip",
      action: "auto",
      intensity: "smart",
      seed: "s1",
    });
    expect(plan.videoType).toBe("action");
    expect(plan.spec.filter).toBe("vivid");
    expect(plan.spec.effects).toContain("zoom-intro");
    expect(plan.spec.sfx?.length ?? 0).toBeGreaterThan(0);
    expect(plan.looped).toBe(true); // short + high loop score
  });

  it("aggressive intensity adds captions to generic content", async () => {
    const plan = await buildEditPlan({
      signal: signal({ cutRate: 0.5, voiceDensity: 0.3 }),
      fileName: "misc.mp4",
      hookText: "",
      action: "auto",
      intensity: "aggressive",
      seed: "s1",
    });
    expect(plan.spec.texts?.length ?? 0).toBeGreaterThan(0);
  });

  it("clean action keeps effects and SFX off", async () => {
    const plan = await buildEditPlan({
      signal: signal({ cutRate: 1.5, voiceDensity: 0.05 }),
      fileName: "clips.mp4",
      hookText: "Clip",
      action: "clean",
      intensity: "smart",
      seed: "s1",
    });
    expect(plan.spec.effects ?? []).toHaveLength(0);
  });

  it("improve-audio keeps the rest of the current spec intact", async () => {
    const current = { ...defaultEditSpec(), filter: "cinematic" as const, texts: [{ id: "t1", text: "Keep me", fontSize: 50, color: "#fff", strokeColor: "#000", y: 30, animation: "fade-in" as const, startSec: 0, endSec: 2 }] };
    const plan = await buildEditPlan({
      signal: signal(),
      fileName: "x.mp4",
      hookText: "Hook",
      action: "improve-audio",
      intensity: "smart",
      currentSpec: current,
      seed: "s1",
    });
    expect(plan.spec.filter).toBe("cinematic");
    expect(plan.spec.texts?.some((t) => t.text === "Keep me")).toBe(true);
    expect(plan.spec.audio).toBeTruthy();
  });

  it("improve-hook retimes the opening", async () => {
    const plan = await buildEditPlan({
      signal: signal({ speech: [{ start: 3.1, end: 14 }], silence: [{ start: 0, end: 3.1 }] }),
      fileName: "x.mp4",
      hookText: "Hook",
      action: "improve-hook",
      intensity: "smart",
      seed: "s1",
    });
    expect(plan.hookRetimed).toBe(true);
  });
});

describe("scoring", () => {
  it("produces scores in 0..100 and a weighted overall", () => {
    const score = computeScore({
      signal: signal(),
      videoType: "talking-head",
      intensity: "smart",
      retimed: true,
      removedSec: 1.2,
      captions: [{ id: "c", text: "Line", fontSize: 56, color: "#fff", strokeColor: "#000", y: 70, animation: "pop", startSec: 0.5, endSec: 2.5 }],
      sfxCount: 2,
      loopApplied: false,
      audioChanged: true,
      finalD: 13,
      finalPace: 1,
      filter: "none",
      hasMusic: true,
    });
    for (const v of Object.values(score)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(score.overall).toBeGreaterThan(40);
  });

  it("QC penalties reduce the score but never below 0", () => {
    const base = {
      hook: 80, visual: 80, audio: 80, pacing: 80, captions: 80, retention: 80, loop: 80, overall: 80,
    };
    const penalized = applyQcPenalty(base, [
      { severity: "major", message: "Audio clipping detected (500 samples)" },
      { severity: "major", message: "Unexpected black frames at 5.0s-6.0s" },
    ]);
    expect(penalized.audio).toBeLessThan(base.audio);
    expect(penalized.visual).toBeLessThan(base.visual);
    expect(penalized.overall).toBeLessThan(base.overall);
    const all = applyQcPenalty(base, [{ severity: "major", message: "Everything is broken" }]);
    for (const v of Object.values(all)) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("captions", () => {
  it("places lines inside speech windows with staggered positions", () => {
    const lines = [
      { text: "DISCIPLINE is everything", emphasis: ["DISCIPLINE"] },
      { text: "consistency wins", emphasis: ["CONSISTENCY"] },
    ];
    const placed = placeCaptions({
      lines,
      speech: [{ start: 0.5, end: 3.5 }, { start: 6, end: 9 }],
      durationSec: 10,
    });
    expect(placed).toHaveLength(2);
    expect(placed[0].startSec).toBeGreaterThanOrEqual(0.5);
    expect(placed[0].endSec).toBeLessThanOrEqual(3.65);
    expect(placed[1].startSec).toBeGreaterThanOrEqual(6);
    expect(placed[0].y).toBeLessThan(placed[1].y);
    expect(placed[0].emphasis).toContain("DISCIPLINE");
  });

  it("falls back to evenly spaced windows without speech", () => {
    const placed = placeCaptions({
      lines: [{ text: "Hello world", emphasis: ["HELLO"] }],
      speech: [],
      durationSec: 8,
    });
    expect(placed).toHaveLength(1);
  });

  it("picks strong words for emphasis", () => {
    const words = pickEmphasis("this is a very interesting opportunity");
    expect(words).toContain("INTERESTING");
    expect(words).toContain("OPPORTUNITY");
  });
});

describe("normalizeEditSpec (new AI fields)", () => {
  it("normalizes cuts, sfx, audio, loop and pacing", () => {
    const spec = normalizeEditSpec({
      cuts: [{ start: 1, end: 2 }, { start: 3, end: 4 }, { start: 4, end: 4.2 }],
      sfx: [
        { at: 1.5, type: "whoosh", volume: 0.5 },
        { at: -1, type: "bogus", volume: 2 },
      ],
      audio: { noiseReduction: false, deesser: true, ducking: true, highpass: true, loudnessTarget: -16 },
      loop: true,
      pacing: 1.2,
    });
    expect(spec.cuts?.map((c) => [c.start, c.end])).toEqual([[1, 2], [3, 4]]);
    expect(spec.sfx).toHaveLength(1);
    expect(spec.sfx?.[0].type).toBe("whoosh");
    expect(spec.sfx?.[0].volume).toBe(0.5);
    expect(spec.audio?.noiseReduction).toBe(false);
    expect(spec.audio?.loudnessTarget).toBe(-16);
    expect(spec.loop).toBe(true);
    expect(spec.pacing).toBe(1.2);
  });

  it("clamps invalid values", () => {
    const spec = normalizeEditSpec({
      pacing: 9,
      audio: { loudnessTarget: 10 },
      sfx: [{ at: 0, type: "impact", volume: 5 }],
    });
    expect(spec.pacing).toBe(1.4);
    expect(spec.audio?.loudnessTarget).toBe(-8);
    expect(spec.sfx?.[0].volume).toBe(1);
  });
});