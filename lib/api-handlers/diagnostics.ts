import { NextRequest } from "next/server";
import { withWorkspace } from "@/lib/api";
import { runDiagnostics } from "@/lib/diagnostics";

export async function GET(req: NextRequest) {
  return withWorkspace(req, async (ctx) => {
    const report = await runDiagnostics(ctx.workspaceId);
    return report;
  });
}
