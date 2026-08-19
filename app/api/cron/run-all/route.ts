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

  for (const job of JOBS) {
    try {
      const res = await fetch(`${BASE}/api/cron/${job}`, {
        method: "POST",
        headers: {
          authorization: req.headers.get("authorization") || "",
        },
      });
      results[job] = await res.json();
    } catch (err) {
      logger.error("run_all_sub_job_failed", { job, error: String(err) });
      results[job] = { error: String(err) };
    }
  }

  return NextResponse.json({ ok: true, results });
}
