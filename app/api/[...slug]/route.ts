import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers: Record<string, { GET?: Function; POST?: Function; PUT?: Function; DELETE?: Function }> = {};

async function getHandler(slug: string) {
  switch (slug) {
    case "admin/stats": return await import("@/lib/api-handlers/admin/stats");
    case "analytics": return await import("@/lib/api-handlers/analytics");
    case "auth/register": return await import("@/lib/api-handlers/auth/register");
    case "automation": return await import("@/lib/api-handlers/automation");
    case "cron/run-all": return await import("@/lib/api-handlers/cron/run-all");
    case "diagnostics": return await import("@/lib/api-handlers/diagnostics");
    case "drive/callback": return await import("@/lib/api-handlers/drive/callback");
    case "drive/connect": return await import("@/lib/api-handlers/drive/connect");
    case "drive/scan": return await import("@/lib/api-handlers/drive/scan");
    case "drive/status": return await import("@/lib/api-handlers/drive/status");
    case "enhancer": return await import("@/lib/api-handlers/enhancer");
    case "music": return await import("@/lib/api-handlers/music");
    case "notifications": return await import("@/lib/api-handlers/notifications");
    case "posts": return await import("@/lib/api-handlers/posts");
    case "schedules": return await import("@/lib/api-handlers/schedules");
    case "settings": return await import("@/lib/api-handlers/settings");
    case "settings/password": return await import("@/lib/api-handlers/settings/password");
    case "social/accounts": return await import("@/lib/api-handlers/social/accounts");
    case "timing": return await import("@/lib/api-handlers/timing");
    case "videos": return await import("@/lib/api-handlers/videos");
    case "videos/queue": return await import("@/lib/api-handlers/videos/queue");
    case "webhooks/meta": return await import("@/lib/api-handlers/webhooks/meta");
    default: return null;
  }
}

async function getDynamicHandler(slug: string, segment: string) {
  if (slug.startsWith("cron/")) return await import("@/lib/api-handlers/cron/job");
  if (slug.startsWith("music/")) return await import("@/lib/api-handlers/music/name");
  if (slug.startsWith("posts/") && slug.endsWith("/retry")) return await import("@/lib/api-handlers/posts/[id]/retry");
  if (slug.startsWith("posts/")) return await import("@/lib/api-handlers/posts/[id]");
  if (slug.startsWith("schedules/")) return await import("@/lib/api-handlers/schedules/[id]");
  if (slug.startsWith("social/") && slug.endsWith("/callback")) return await import("@/lib/api-handlers/social/callback");
  if (slug.startsWith("social/") && slug.endsWith("/connect")) return await import("@/lib/api-handlers/social/connect");
  if (slug.startsWith("social/") && slug.endsWith("/disconnect")) return await import("@/lib/api-handlers/social/disconnect");
  if (slug.startsWith("videos/") && slug.endsWith("/ai-edit")) return await import("@/lib/api-handlers/videos/ai-edit");
  if (slug.startsWith("videos/") && slug.endsWith("/content")) return await import("@/lib/api-handlers/videos/content");
  if (slug.startsWith("videos/") && slug.endsWith("/edit")) return await import("@/lib/api-handlers/videos/edit");
  if (slug.startsWith("videos/") && slug.endsWith("/motion-design")) return await import("@/lib/api-handlers/videos/motion-design");
  if (slug.startsWith("videos/") && slug.endsWith("/publish-now")) return await import("@/lib/api-handlers/videos/publish-now");
  if (slug.startsWith("videos/") && slug.endsWith("/render")) return await import("@/lib/api-handlers/videos/render");
  if (slug.startsWith("videos/") && slug.endsWith("/schedule")) return await import("@/lib/api-handlers/videos/schedule");
  if (slug.startsWith("videos/") && slug.endsWith("/stream")) return await import("@/lib/api-handlers/videos/stream");
  if (slug.startsWith("videos/") && slug.endsWith("/thumbnail")) return await import("@/lib/api-handlers/videos/thumbnail");
  return null;
}

function buildSlug(pathname: string): string {
  const cleaned = pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  return cleaned;
}

async function handleRequest(req: NextRequest, method: string) {
  const { pathname } = new URL(req.url);
  const slug = buildSlug(pathname);

  if (!slug || slug === "auth") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let mod: any = await getHandler(slug);
  if (!mod) {
    mod = await getDynamicHandler(slug, slug);
  }

  if (!mod) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const handler = mod[method];
  if (!handler) {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    return await handler(req, { params: Promise.resolve(extractParams(slug, pathname)) });
  } catch (err) {
    console.error("API handler error:", slug, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function extractParams(slug: string, _pathname: string): Record<string, string> {
  const parts = slug.split("/");

  if (slug.startsWith("cron/")) {
    return { job: parts[1] || "" };
  }

  if (slug.startsWith("music/")) {
    return { name: parts[1] || "" };
  }

  if (slug.startsWith("posts/") && parts.length >= 2) {
    return { id: parts[1] };
  }

  if (slug.startsWith("schedules/") && parts.length >= 2) {
    return { id: parts[1] };
  }

  if (slug.startsWith("social/") && parts.length >= 2) {
    return { platform: parts[1] };
  }

  if (slug.startsWith("videos/") && parts.length >= 2) {
    return { id: parts[1] };
  }

  return {};
}

export async function GET(req: NextRequest) {
  return handleRequest(req, "GET");
}

export async function POST(req: NextRequest) {
  return handleRequest(req, "POST");
}

export async function PUT(req: NextRequest) {
  return handleRequest(req, "PUT");
}

export async function DELETE(req: NextRequest) {
  return handleRequest(req, "DELETE");
}
