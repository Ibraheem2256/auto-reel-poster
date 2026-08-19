import { writeFile } from "fs/promises";
import type { SfxType } from "@/lib/editor-spec";

/**
 * Synthesized sound effects — generated locally as 16-bit PCM WAV files,
 * so they are 100% copyright-free by construction (no downloads, no licenses
 * to track, no "popular" sounds to avoid). Every effect is short and tuned
 * for vertical short-form pacing.
 *
 * All effects are generated from pure math (sine waves, one-pole filtered
 * white noise, exponential envelopes) at 44.1 kHz mono.
 */

const SAMPLE_RATE = 44100;

interface Wave {
  sample: (t: number) => number;
  duration: number;
  /** Global amplitude before peak normalization (0..1). */
  gain: number;
}

const TAU = Math.PI * 2;

function noise(): number {
  // Deterministic-ish white noise (Math.random is fine here; it is not
  // used for anything security-related).
  return Math.random() * 2 - 1;
}

/** One-pole low-pass coefficient for a cutoff frequency. */
function lpCoef(fc: number): number {
  return 1 - Math.exp((-TAU * fc) / SAMPLE_RATE);
}

/** One-pole high-pass coefficient for a cutoff frequency. */
function hpCoef(fc: number): number {
  return Math.exp((-TAU * fc) / SAMPLE_RATE);
}

function lowpass(data: Float64Array, fc: number): Float64Array {
  const a = lpCoef(fc);
  const out = new Float64Array(data.length);
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y += a * (data[i] - y);
    out[i] = y;
  }
  return out;
}

function highpass(data: Float64Array, fc: number): Float64Array {
  const a = hpCoef(fc);
  const out = new Float64Array(data.length);
  let y = 0;
  let prevX = 0;
  for (let i = 0; i < data.length; i++) {
    y = a * (y + data[i] - prevX);
    prevX = data[i];
    out[i] = y;
  }
  return out;
}

function noiseBurst(duration: number): Float64Array {
  const out = new Float64Array(Math.ceil(duration * SAMPLE_RATE));
  for (let i = 0; i < out.length; i++) out[i] = noise();
  return out;
}

const SFX_DEFS: Record<SfxType, () => Wave> = {
  /** Short bright tick. */
  click: () => {
    const f = (t: number) => Math.sin(TAU * 1900 * t) * Math.exp(-t * 65);
    return { sample: f, duration: 0.07, gain: 0.5 };
  },

  /** Lower, softer tick. */
  pop: () => {
    const f = (t: number) => Math.sin(TAU * (420 - 120 * t) * t) * Math.exp(-t * 38);
    return { sample: f, duration: 0.12, gain: 0.55 };
  },

  /** Fast noise sweep (UI swipe / quick transition). */
  swipe: () => {
    const d = 0.28;
    return {
      sample: (t) => {
        const env = Math.min(1, t / 0.05) * Math.exp(-(t / 0.11) * (t / 0.11));
        return noise() * env;
      },
      duration: d,
      gain: 0.42,
    };
  },

  /** Rising-then-falling noise sweep (transition whoosh). */
  whoosh: () => {
    const d = 0.75;
    const base = noiseBurst(d);
    const swept = lowpass(base, 3200);
    return {
      sample: (t) => {
        const i = Math.min(base.length - 1, Math.floor(t * SAMPLE_RATE));
        const env = Math.sin((Math.PI * t) / d) ** 2;
        return swept[i] * env;
      },
      duration: d,
      gain: 0.5,
    };
  },

  /** Sub-lows + noise crack (beat drop / punch). */
  impact: () => {
    const d = 0.5;
    return {
      sample: (t) => {
        const sub = Math.sin(TAU * 68 * t) * Math.exp(-t * 11);
        const crack = t < 0.04 ? noise() * (1 - t / 0.04) * 0.6 : 0;
        return sub + crack;
      },
      duration: d,
      gain: 0.6,
    };
  },

  /** Brighter, shorter hit. */
  hit: () => {
    const d = 0.2;
    return {
      sample: (t) => {
        const body = Math.sin(TAU * 130 * t) * Math.exp(-t * 26);
        const tick = t < 0.02 ? noise() * 0.5 : 0;
        return body + tick;
      },
      duration: d,
      gain: 0.55,
    };
  },

  /** Deep cinematic boom (ending / big moment). */
  boom: () => {
    const d = 1.0;
    return {
      sample: (t) => {
        const sub = Math.sin(TAU * 52 * t) * Math.exp(-t * 4.2);
        const rumble = lowpass(noiseBurst(d), 120)[Math.min(Math.floor(t * SAMPLE_RATE), d * SAMPLE_RATE - 1)];
        return sub * 1.2 + rumble * 0.5 * Math.exp(-t * 3);
      },
      duration: d,
      gain: 0.7,
    };
  },

  /** Noise that builds up (leads into a moment). */
  riser: () => {
    const d = 0.9;
    const base = noiseBurst(d);
    const swept = lowpass(base, 3500);
    return {
      sample: (t) => {
        const i = Math.min(base.length - 1, Math.floor(t * SAMPLE_RATE));
        const env = (t / d) ** 2;
        return swept[i] * env;
      },
      duration: d,
      gain: 0.4,
    };
  },

  /** Down-chirp ending in a thud (drop). */
  drop: () => {
    const d = 0.4;
    return {
      sample: (t) => {
        const chirp = Math.sin(TAU * (900 - 1900 * t) * t) * Math.exp(-t * 9);
        const thud = t > 0.28 ? Math.sin(TAU * 70 * (t - 0.28)) * Math.exp(-(t - 0.28) * 30) : 0;
        return chirp + thud;
      },
      duration: d,
      gain: 0.55,
    };
  },

  /** Stuttering square burst (glitch). */
  glitch: () => {
    const d = 0.22;
    return {
      sample: (t) => {
        const carrier = Math.sin(TAU * 720 * t);
        const gate = Math.sign(Math.sin(TAU * 42 * t));
        return carrier * gate * Math.exp(-t * 18);
      },
      duration: d,
      gain: 0.45,
    };
  },
};

/** Synthesize an SFX and write it to `outPath` as a mono 16-bit WAV. */
export async function synthesizeSfx(type: SfxType, outPath: string): Promise<void> {
  const def = SFX_DEFS[type]();
  const n = Math.max(1, Math.ceil(def.duration * SAMPLE_RATE));
  const samples = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    samples[i] = def.sample(t) * def.gain;
  }
  // Normalize to peak 0.9 (consistent perceived level across types).
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak > 0.001) {
    const k = 0.9 / peak;
    for (let i = 0; i < n; i++) samples[i] *= k;
  }
  const wav = Buffer.alloc(44 + n * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + n * 2, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  await writeFile(outPath, wav);
}