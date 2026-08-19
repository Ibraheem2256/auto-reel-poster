import { describe, expect, it } from "vitest";
import { normalizeEditSpec, defaultEditSpec } from "@/lib/editor-spec";
import { defaultMotionSpec, type MotionAnalysis, type MotionSpec } from "@/lib/motion/types";
import { createMotionDesign, normalizeStyle, pickStyle } from "@/lib/motion/select";
import {
  buildPieces,
  computeCameraExpressions,
  pieceFinalDuration,
  smoothKeyframeExpr,
  specToPieces,
  trackExpr,
} from "@/lib/motion/render";
import { detectBeatsFromPcm } from "@/lib/motion/analyze";

function analysis(overrides: Partial<MotionAnalysis> = {}): MotionAnalysis {
  return {
    beats: { beats: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0], bpm: 120, confident: true },
    motion: { windowSec: 0.5, samples: [], avg: 0 },
    subject: { available: false, samples: [] },
    musicDriven: true,
    ...overrides,
  };
}

const baseInput = {
  analysis: analysis(),
  signal: {
    durationSec: 8,
    cutRate: 0.4,
    hasAudio: true,
    sceneChanges: [] as number[],
    voiceDensity: 0.3,
    brightness: 0.5,
  },
  videoType: "motivational",
  intensity: "smart" as const,
  texts: [{ id: "c0", text: "One two three four", startSec: 0.5 }],
  durationSec: 8,
  seed: "test-seed",
};

describe("normalizeStyle", () => {
  it("defaults to modern-cinematic", () => {
    expect(normalizeStyle("garbage")).toBe("modern-cinematic");
    expect(normalizeStyle(undefined)).toBe("modern-cinematic");
  });
  it("keeps valid styles", () => {
    expect(normalizeStyle("energetic-pop")).toBe("energetic-pop");
    expect(normalizeStyle("clean-minimal")).toBe("clean-minimal");
  });
});

describe("pickStyle", () => {
  it("prefers modern-cinematic when rhythm-driven", () => {
    expect(pickStyle(baseInput)).toBe("modern-cinematic");
  });
  it("picks clean-minimal for quiet footage", () => {
    const quiet = {
      ...baseInput,
      videoType: "generic",
      analysis: analysis({ musicDriven: false, beats: { beats: [], bpm: 0, confident: false } }),
    };
    expect(pickStyle(quiet)).toBe("clean-minimal");
  });
});

describe("createMotionDesign", () => {
  it("is deterministic for the same input", () => {
    const a = createMotionDesign(baseInput);
    const b = createMotionDesign(baseInput);
    expect(JSON.stringify(a.spec)).toBe(JSON.stringify(b.spec));
    expect(a.spec.enabled).toBe(true);
  });

  it("applies restraint: not every intensity escalates everything", () => {
    const subtle = createMotionDesign({ ...baseInput, intensity: "subtle" });
    const agg = createMotionDesign({ ...baseInput, intensity: "aggressive" });
    expect(subtle.spec.shake.strength).toBeLessThanOrEqual(agg.spec.shake.strength);
    expect(subtle.spec.trails).toBeLessThanOrEqual(agg.spec.trails);
    expect(subtle.spec.beatPulse).toBeLessThanOrEqual(agg.spec.beatPulse);
  });

  it("designs 3D treatment for every text", () => {
    const d = createMotionDesign(baseInput);
    for (const t of baseInput.texts) {
      expect(d.spec.text3d[t.id]).toBeTruthy();
    }
  });

  it("keeps effects off for a clip that is too short", () => {
    const d = createMotionDesign({ ...baseInput, durationSec: 1.5, texts: [] });
    expect(d.spec.enabled).toBe(false);
    expect(d.notes.some((n) => /too short/i.test(n))).toBe(true);
  });

  it("tracks the subject when samples exist", () => {
    const d = createMotionDesign({
      ...baseInput,
      analysis: analysis({
        subject: {
          available: true,
          samples: [
            { t: 0, cx: 0.5, cy: 0.5, w: 0.3, h: 0.4, present: 0.5 },
            { t: 1, cx: 0.6, cy: 0.5, w: 0.3, h: 0.4, present: 0.5 },
            { t: 2, cx: 0.5, cy: 0.5, w: 0.3, h: 0.4, present: 0.5 },
            { t: 3, cx: 0.5, cy: 0.5, w: 0.3, h: 0.4, present: 0.5 },
          ],
        },
      }),
    });
    expect(d.spec.subjectTrack).toBeTruthy();
    expect(d.spec.needsSubject).toBe(true);
  });

  it("maps beats through the cut timeline", () => {
    const timeline = { segments: [{ start: 0, end: 2 }, { start: 5, end: 8 }], finalDuration: 5 };
    const d = createMotionDesign({ ...baseInput, timeline });
    // Source beat 5.0 lands at final 2.0.
    expect(d.spec.beats).toContain(2);
  });

  it("produces explainable changes and no empty why", () => {
    const d = createMotionDesign(baseInput);
    expect(d.changes.length).toBeGreaterThan(0);
    for (const c of d.changes) {
      expect(c.what.length).toBeGreaterThan(3);
      expect(c.why.length).toBeGreaterThan(10);
    }
  });
});

describe("buildPieces / specToPieces", () => {
  it("splits a window with a slow-mo ramp", () => {
    const pieces = buildPieces({
      trimStart: 0,
      trimEnd: 10,
      cuts: null,
      ramps: [{ start: 3, end: 5, factor: 0.5 }],
      sourceDuration: 10,
    });
    expect(pieces.length).toBe(3);
    expect(pieces[0]).toEqual({ start: 0, end: 3, factor: 1 });
    expect(pieces[1]).toEqual({ start: 3, end: 5, factor: 0.5 });
    expect(pieces[2]).toEqual({ start: 5, end: 10, factor: 1 });
  });

  it("respects cut boundaries when ramps are applied", () => {
    const pieces = specToPieces(
      { trim: { start: 0, end: 10 }, cuts: [{ start: 2, end: 8 }] },
      { ...defaultMotionSpec(), speedRamps: [{ start: 4, end: 6, factor: 0.6 }] },
      10
    );
    expect(pieces.length).toBe(3);
    expect(pieces[0].start).toBe(2);
    expect(pieces[2].end).toBe(8);
  });

  it("computes final duration from pieces", () => {
    const pieces = buildPieces({
      trimStart: 0,
      trimEnd: 6,
      cuts: null,
      ramps: [{ start: 1, end: 3, factor: 0.5 }],
      sourceDuration: 6,
    });
    const total = pieces.reduce((a, p) => a + pieceFinalDuration(p), 0);
    expect(total).toBeCloseTo(2 + 4 + 2, 5);
  });
});

describe("expression builders", () => {
  it("smoothKeyframeExpr is a constant for a single key", () => {
    expect(smoothKeyframeExpr([{ t: 0, v: 1.07 }])).toBe("1.0700");
  });

  it("smoothKeyframeExpr interpolates between keys", () => {
    const e = smoothKeyframeExpr([{ t: 0, v: 1 }, { t: 5, v: 2 }]);
    expect(e).toContain("pow(max(0,1-abs(t-0.000)/4.000),3)");
  });

  it("camera expressions respect max zoom bounds", () => {
    const spec: MotionSpec = {
      ...defaultMotionSpec(),
      camera: [{ t: 0, zoom: 1.4, panX: 0, panY: 0 }],
      punchIn: { at: 1, strength: 0.4 },
      beatPulse: 0.5,
    };
    const cam = computeCameraExpressions(spec, 1080, 1920);
    expect(cam.ow).toBeGreaterThan(1080);
    expect(cam.oh).toBeGreaterThan(1920);
    expect(cam.ow / cam.oh).toBeCloseTo(1080 / 1920, 5);
  });

  it("trackExpr subsamples to a bounded expression", () => {
    const samples = Array.from({ length: 200 }, (_, i) => ({
      t: i * 0.1,
      cx: 0.5,
      cy: 0.5,
      w: 0.2,
      h: 0.2,
      present: 1,
    }));
    const e = trackExpr({ available: true, samples }, (s) => s.cx, 20);
    // stride 8 → 25 sampled keys + last anchor; 2 pow() per key.
    expect(e.split("pow(").length - 1).toBeLessThanOrEqual(54);
    expect(e.length).toBeLessThan(5000);
  });
});

describe("detectBeatsFromPcm", () => {
  it("detects a clean 2 Hz pulse", () => {
    const rate = 16000;
    const secs = 4;
    const pcm = Buffer.alloc(rate * secs * 2);
    const bpm = 120;
    const period = (60 / bpm) * rate;
    for (let i = 0; i < rate * secs; i++) {
      const t = i / rate;
      const beatEnvelope = Math.exp(-(((i % period) / (period * 0.25)) ** 2));
      const v = 0.2 * beatEnvelope * Math.sin(2 * Math.PI * 180 * t) + 0.01 * Math.sin(2 * Math.PI * 440 * t);
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32768))), i * 2);
    }
    const beats = detectBeatsFromPcm(pcm, rate);
    expect(beats.beats.length).toBeGreaterThanOrEqual(5);
    const gap = beats.beats[1] - beats.beats[0];
    expect(gap).toBeGreaterThan(0.35);
    expect(gap).toBeLessThan(0.7);
    expect(beats.bpm).toBeGreaterThan(90);
    expect(beats.bpm).toBeLessThan(150);
    expect(beats.confident).toBe(true);
  });

  it("returns the fallback grid for silence", () => {
    const beats = detectBeatsFromPcm(Buffer.alloc(16000 * 2 * 2), 16000);
    expect(beats.beats).toEqual([]);
    expect(beats.confident).toBe(false);
  });
});

describe("normalizeEditSpec with motion", () => {
  it("drops motion when disabled", () => {
    const spec = normalizeEditSpec({ motion: { enabled: false } });
    expect(spec.motion).toBeNull();
  });

  it("normalizes a valid motion spec", () => {
    const motion = {
      enabled: true,
      style: "energetic-pop",
      intensity: "aggressive",
      beats: [0.5, 1.5, "x", 2.5],
      camera: [{ t: 0, zoom: 1.2, panX: 0, panY: 0 }],
      shakeStrength: 0.3,
      text3d: { c0: { depth: 2, rotateX: 4, rotateY: 3, entrance: "flip", kinetic: true, follow: true, behind: true, accent: true } },
      needsSubject: true,
    };
    const spec = normalizeEditSpec({ motion });
    expect(spec.motion).toBeTruthy();
    expect(spec.motion!.style).toBe("energetic-pop");
    expect(spec.motion!.beats).toEqual([0.5, 1.5, 2.5]);
    expect(spec.motion!.text3d.c0.entrance).toBe("flip");
    expect(spec.motion!.needsSubject).toBe(true);
  });

  it("round-trips through defaultEditSpec", () => {
    const spec = normalizeEditSpec(defaultEditSpec());
    expect(spec.motion).toBeNull();
    expect(spec.pacing).toBe(1);
  });
});