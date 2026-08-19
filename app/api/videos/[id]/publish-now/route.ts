import { type NextRequest } from "next/server";
import { requireAuth, getIp } from "@/lib/api";
import { publishVideoNow } from "@/lib/scheduler";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STAGE_LABELS: Record<string, string> = {
  edit: "Auto-editing video (9:16 + hook + sound)…",
  download: "Downloading video…",
  "upload:TIKTOK": "Uploading to TikTok…",
  "upload:YOUTUBE": "Uploading to YouTube…",
  "upload:INSTAGRAM": "Uploading to Instagram…",
  "upload:FACEBOOK": "Uploading to Facebook…",
};

/**
 * POST /api/videos/[id]/publish-now — publishes the video and streams
 * Server-Sent Events with live progress stages so the UI can show a loading
 * screen. Emits: {type:"stage",stage,label}, {type:"result",results},
 * {type:"error",error}.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;

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

      let body: { title?: string; caption?: string; description?: string; hashtags?: string[] } = {};
      try {
        body = await req.json().catch(() => ({}));
      } catch {
        body = {};
      }
      const hashtags = Array.isArray(body.hashtags)
        ? body.hashtags.map((h) => h.replace(/^#/, "").trim()).filter(Boolean)
        : undefined;
      const caption =
        typeof body.caption === "string" && body.caption.trim()
          ? [body.caption.trim(), hashtags?.length ? hashtags.map((h) => `#${h}`).join(" ") : ""]
              .filter(Boolean)
              .join("\n\n")
          : undefined;
      const override = {
        ...(typeof body.title === "string" && body.title.trim() ? { title: body.title.trim() } : {}),
        ...(caption ? { caption } : {}),
        ...(typeof body.description === "string" && body.description.trim()
          ? { description: body.description.trim() }
          : {}),
        ...(hashtags ? { hashtags } : {}),
      };
      const hasOverride = Object.keys(override).length > 0;

      try {
        const results = await publishVideoNow(
          auth.workspaceId,
          id,
          hasOverride ? override : undefined,
          (stage) => {
            send({ type: "stage", stage, label: STAGE_LABELS[stage] ?? "Processing…" });
          }
        );
        await audit({
          workspaceId: auth.workspaceId,
          userId: auth.userId,
          action: "video.posted_now",
          entityType: "Video",
          entityId: id,
          metadata: { results, edited: hasOverride },
          ip: await getIp(req),
        });
        send({ type: "result", results });
      } catch (err) {
        const { getErrorMessage } = await import("@/lib/utils");
        send({ type: "error", error: getErrorMessage(err) });
      } finally {
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
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}