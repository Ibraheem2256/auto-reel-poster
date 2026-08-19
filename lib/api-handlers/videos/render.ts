import { type NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "fs";
import { requireAuth } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/utils";
import { normalizeEditSpec } from "@/lib/editor-spec";
import { editVideoForPublish, cleanupEditedFile } from "@/lib/editor";

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
  const spec = normalizeEditSpec(body?.editSpec ?? video.editSpec);
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

      let filePath: string | undefined;
      try {
        send({ type: "stage", stage: "download", label: "Downloading video from Drive…" });
        const result = await editVideoForPublish({
          workspaceId: auth.workspaceId,
          driveFileId: video.driveFileId,
          hookText: video.title || video.fileName,
          durationMs: video.durationMs,
          spec,
          preview: true,
          maxSeconds,
          onStage: (stage, pct) => {
            const labels: Record<string, string> = {
              download: "Downloading video from Drive…",
              "bg-removal": pct && pct > 0
                ? `Removing background… (${pct} frames)`
                : "Removing background (AI person cut-out)…",
              edit: "Rendering effects, filters and sound…",
              done: "Encoding…",
            };
            send({ type: "stage", stage, label: labels[stage] ?? "Processing…" });
          },
        });
        filePath = result.filePath;

        const stat = statSync(filePath);
        send({
          type: "done",
          durationMs: result.durationMs,
          width: result.width,
          height: result.height,
          musicTrack: result.musicTrack,
          bgRemoved: result.bgRemoved,
          size: stat.size,
        });
        controller.enqueue(SENTINEL);
        const pathToRead = filePath as string;
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
      } catch (err) {
        send({ type: "error", error: getErrorMessage(err) });
        logger.warn("render_failed", { videoId: id, error: getErrorMessage(err) });
      } finally {
        if (filePath) await cleanupEditedFile(filePath).catch(() => {});
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
      "Content-Disposition": `attachment; filename="preview-${video.id}.mp4"`,
    },
  });
}
