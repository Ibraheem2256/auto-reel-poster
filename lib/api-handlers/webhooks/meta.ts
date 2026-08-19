import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqualStrings } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

function verifyMetaSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signature.replace(/^sha256=/, "");
  return timingSafeEqualStrings(expected, provided);
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const contentType = req.headers.get("content-type") ?? "";

  const query = new URL(req.url).searchParams;
  if (query.get("hub.mode") === "subscribe" && query.get("hub.challenge")) {
    return new NextResponse(query.get("hub.challenge")!, { status: 200 });
  }

  if (contentType.includes("json") && !verifyMetaSignature(rawBody, signature)) {
    logger.warn("meta_webhook_rejected", { signatureProvided: Boolean(signature) });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const body = JSON.parse(rawBody);
    const entry = body?.entry?.[0];
    if (!entry) return NextResponse.json({ ok: true });

    const changes = entry.changes ?? [];
    for (const change of changes) {
      logger.info("meta_webhook_received", {
        object: body.object,
        field: change.field,
        item: change.value?.item,
        videoId: change.value?.video_id ?? change.value?.id,
      });
      if (change.field === "video_status" && change.value?.video_id) {
        await prisma.platformJob.updateMany({
          where: { platformPostId: String(change.value.video_id) },
          data: {
            status: "SUCCESS",
            publishedAt: new Date(),
            platformPostUrl:
              change.value?.permalink_url ?? `https://www.facebook.com/videos/${change.value.video_id}`,
          },
        });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("meta_webhook_parse_failed", { error: String(err) });
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const query = new URL(req.url).searchParams;
  if (query.get("hub.mode") === "subscribe" && query.get("hub.challenge")) {
    return new NextResponse(query.get("hub.challenge")!, { status: 200 });
  }
  return NextResponse.json({ ok: true });
}
