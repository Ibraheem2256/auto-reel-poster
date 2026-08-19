import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { requireWorkspace } from "@/lib/workspace";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/utils";
import { timingSafeEqualStrings } from "@/lib/crypto";

export interface AuthedContext {
  userId: string;
  workspaceId: string;
}

export async function requireAuth(req?: NextRequest): Promise<AuthedContext | NextResponse> {
  const user = await getSessionUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const workspaceId = user.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 403 });
  }
  return { userId: user.id, workspaceId };
}

export async function withWorkspace<T>(
  req: NextRequest,
  handler: (ctx: AuthedContext) => Promise<T>
): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    await requireWorkspace(auth.userId, auth.workspaceId);
    const result = await handler(auth);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export function errorResponse(err: unknown, status = 500): NextResponse {
  const message = getErrorMessage(err);
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code ?? "UNKNOWN")
      : "UNKNOWN";
  logger.error("api_error", { code, message: message.slice(0, 300), status });
  return NextResponse.json(
    { error: message, code },
    { status: status >= 400 && status < 600 ? status : 500 }
  );
}

export async function checkRateLimit(req: NextRequest, key: string, limit = 30, windowSeconds = 60) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const res = await rateLimit(`api:${key}:${ip}`, limit, windowSeconds);
  if (!res.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down.", retryAfter: res.retryAfter },
      { status: 429, headers: { "Retry-After": String(res.retryAfter) } }
    );
  }
  return null;
}

/** Verify the cron auth header (used by platform cron triggers). */
export function verifyCronRequest(req: NextRequest): boolean {
  // Vercel Cron Jobs use x-vercel-cron header (no secret needed)
  if (req.headers.get("x-vercel-cron")) return true;

  // Local cron daemon uses x-cron-secret header
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = req.headers.get("x-cron-secret");
  if (!provided) return false;
  return timingSafeEqualStrings(provided, secret);
}

export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export async function getIp(req: NextRequest): Promise<string | null> {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}