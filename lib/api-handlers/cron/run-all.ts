import { NextResponse, type NextRequest } from "next/server";
import { verifyCronRequest } from "@/lib/api";
import { logger } from "@/lib/logger";

const BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

const JOBS = ["scan", "publish", "check-status", "retry", "cleanup", "token-check"];

export async function GET(req: NextRequest) {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  // Build headers that sub-jobs will accept for cron verification
  const cronHeaders: Record<string, string> = {};
  if (req.headers.get("x-vercel-cron")) {
    cronHeaders["x-vercel-cron"] = "1";
  } else if (req.headers.get("x-cron-secret")) {
    cronHeaders["x-cron-secret"] = req.headers.get("x-cron-secret")!;
  }

  for (const job of JOBS) {
    try {
      const res = await fetch(`${BASE}/api/cron/${job}`, {
        method: "POST",
        headers: cronHeaders,
      });
      results[job] = await res.json();
    } catch (err) {
      logger.error("run_all_sub_job_failed", { job, error: String(err) });
      results[job] = { error: String(err) };
    }
  }

  return NextResponse.json({ ok: true, results });
}
