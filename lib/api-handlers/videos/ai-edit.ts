import { type NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "fs";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/utils";
import { normalizeEditSpec } from "@/lib/editor-spec";
import { cleanupEditedFile } from "@/lib/editor";
import { runAiEdit } from "@/lib/ai-edit/pipeline";
import type { AiEditAction, AiEditIntensity } from "@/lib/ai-edit/types";

const ACTIONS: AiEditAction[] = [
  "auto",
  "re-edit",
  "cinematic",
  "viral",
  "clean",
  "fast",
  "emotional",
  "professional",
  "improve-audio",
  "improve-color",
  "improve-hook",
  "improve-captions",
  "improve-ending",
  "create-loop",
];
const INTENSITIES: AiEditIntensity[] = ["subtle", "smart", "aggressive"];

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
  const action: AiEditAction = ACTIONS.includes(body?.action) ? body.action : "auto";
  const intensity: AiEditIntensity = INTENSITIES.includes(body?.intensity) ? body.intensity : "smart";
  const maxSeconds = Number(body?.maxSeconds ?? 0) > 0 ? Number(body.maxSeconds) : undefined;

  const encoder = new TextEncoder();
  const SENTINEL = new Uint8Array([0x00, 0x41, 0x52, 0x50, 0x52, 0x45, 0x4e, 0x44, 0x00]);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // client disconnected
        }
      };

      let previewPath: string | undefined;
      try {
        send({ type: "stage", stage: "analyze", label: "Analyzing your video (silence, scenes, motion, audio)…" });
        const result = await runAiEdit({
          workspaceId: auth.workspaceId,
          driveFileId: video.driveFileId,
          fileName: video.fileName,
          hookText: video.title || video.fileName,
          durationMs: video.durationMs,
          action,
          intensity,
          currentSpec: video.editSpec ? normalizeEditSpec(video.editSpec) : null,
          maxSeconds,
          onStage: (stage, label) => send({ type: "stage", stage, label }),
        });
        previewPath = result.preview?.filePath;

        await prisma.video.update({
          where: { id: video.id },
          data: { editSpec: result.plan.spec as never },
        });

        const stat = previewPath ? statSync(previewPath) : null;
        send({
          type: "plan",
          plan: {
            videoType: result.plan.videoType,
            intensity: result.plan.intensity,
            action: result.plan.action,
            summary: result.plan.summary,
            changes: result.plan.changes,
            score: result.plan.score,
            analysisNotes: result.plan.analysisNotes,
            revisions: result.plan.revisions,
            hookRetimed: result.plan.hookRetimed,
            looped: result.plan.looped,
            sfxUsed: result.plan.sfxUsed,
            musicTrack: result.plan.musicTrack,
            spec: result.plan.spec,
            size: stat?.size ?? 0,
            sourceDurationMs: video.durationMs,
          },
        });
        controller.enqueue(SENTINEL);
        if (previewPath) {
          const pathToRead = previewPath as string;
          await new Promise<void>((resolvePromise, reject) => {
            const reader = createReadStream(pathToRead);
            reader.on("data", (chunk: string | Buffer) => {
              try {
                controller.enqueue(new Uint8Array(chunk as Buffer));
              } catch {
                reader.destroy();
              }
            });
            reader.on("end", resolvePromise);
            reader.on("error", reject);
          });
          await cleanupEditedFile(previewPath).catch(() => {});
          previewPath = undefined;
        }
      } catch (err) {
        send({ type: "error", error: getErrorMessage(err) });
        logger.warn("ai_edit_failed", { videoId: id, error: getErrorMessage(err) });
        try { controller.enqueue(SENTINEL); } catch { /* ignore */ }
      } finally {
        if (previewPath) await cleanupEditedFile(previewPath).catch(() => {});
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
      "Content-Disposition": `attachment; filename="ai-edit-${video.id}.mp4"`,
    },
  });
}
