import { NextRequest } from "next/server";
import { withWorkspace } from "@/lib/api";
import { analyzeTiming } from "@/lib/timing-optimizer";

export async function GET(req: NextRequest) {
  return withWorkspace(req, async (ctx) => {
    const report = await analyzeTiming(ctx.workspaceId);
    return report;
  });
}
