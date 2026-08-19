import { NextRequest, NextResponse } from "next/server";
import { mkdtempSync, promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createWriteStream } from "fs";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/utils";
import { streamVideoFromDrive } from "@/lib/storage";
import { analyzeMotion } from "@/lib/motion/analyze";
import { createMotionDesign } from "@/lib/motion/select";
import type { MotionIntensity, MotionStyleKey } from "@/lib/motion/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTENSITIES: MotionIntensity[] = ["subtle", "smart", "aggressive"];
const STYLES: MotionStyleKey[] = ["modern-cinematic", "dynamic-punchy", "clean-minimal", "energetic-pop"];

/**
 * POST /api/videos/[id]/motion-design
 *
 * Analyzes the video (beats, motion energy, subject track) and runs the AI
 * Motion Graphics selector. Returns the design (spec + changes + notes + sfx)
 * WITHOUT rendering — the caller saves it onto the edit spec and can render
 * normally. Also streams SSE stage events for progress.
 *
 * Body: { videoType?, intensity?, style?, maxSeconds? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const video = await prisma.video.findFirst({ where: { id, workspaceId: auth.workspaceId } });
  if (!video) {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }
  if (video.invalidReason) {
    return NextResponse.json({ error: `Video is not editable: ${video.invalidReason}` }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const videoType: string = typeof body?.videoType === "string" && body.videoType ? body.videoType : "generic";
  const intensity: MotionIntensity = INTENSITIES.includes(body?.intensity) ? body.intensity : "smart";
  const style: MotionStyleKey | null = STYLES.includes(body?.style) ? body.style : null;
  const maxSeconds = Number(body?.maxSeconds ?? 0) > 0 ? Number(body.maxSeconds) : undefined;
  const texts: { id: string; text: string; startSec: number | null }[] = Array.isArray(body?.texts)
    ? (body.texts as { id?: string; text?: string; startSec?: number | null }[])
        .filter((t) => t && typeof t.text === "string" && t.text.trim())
        .map((t) => ({ id: t.id ?? `t${Math.random()}`, text: t.text!.trim().slice(0, 60), startSec: t.startSec ?? 0 }))
    : [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // client disconnected
        }
      };
      let tempDir: string | null = null;
      try {
        send({ type: "stage", stage: "download", label: "Downloading video…" });
        tempDir = mkdtempSync(join(tmpdir(), "arp-motion-design-"));
        const sourceFile = join(tempDir, "source.mp4");
        const driveStream = await streamVideoFromDrive(auth.workspaceId, video.driveFileId);
        await new Promise<void>((resolvePromise, reject) => {
          const out = createWriteStream(sourceFile);
          driveStream.on("error", reject);
          out.on("error", reject);
          out.on("finish", resolvePromise);
          driveStream.pipe(out);
        });

        send({ type: "stage", stage: "analyze", label: "Detecting beats and tracking the subject…" });
        const analysis = await analyzeMotion(sourceFile, { maxSeconds });

        send({ type: "stage", stage: "design", label: "Designing motion graphics…" });
        const durationSec = Math.min(maxSeconds ?? 600, (video.durationMs ?? 60_000) / 1000);
        const design = createMotionDesign({
          analysis,
          signal: {
            durationSec,
            cutRate: 0.4,
            hasAudio: analysis.beats.beats.length > 0,
            sceneChanges: [],
            voiceDensity: 0,
            brightness: 0.5,
          },
          videoType,
          intensity,
          style,
          texts,
          durationSec,
          seed: `${video.id}|motion-design|${intensity}`,
          force: true,
        });

        send({
          type: "design",
          design: {
            spec: design.spec,
            changes: design.changes,
            notes: design.notes,
            sfx: design.sfx,
            analysis: {
              beats: analysis.beats.beats,
              bpm: analysis.beats.bpm,
              confident: analysis.beats.confident,
              musicDriven: analysis.musicDriven,
              subjectAvailable: analysis.subject.available,
              subjectSamples: analysis.subject.samples.length,
              motionAvg: Math.round(analysis.motion.avg * 1000) / 1000,
            },
          },
        });
      } catch (err) {
        send({ type: "error", error: getErrorMessage(err) });
        logger.warn("motion_design_failed", { videoId: id, error: getErrorMessage(err) });
      } finally {
        if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        try {
          controller.close();
        } catch {
          // ignore
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}