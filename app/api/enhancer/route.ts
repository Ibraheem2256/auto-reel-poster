import { NextRequest } from "next/server";
import { withWorkspace } from "@/lib/api";
import { generateEnhancements } from "@/lib/view-enhancer";

export async function GET(req: NextRequest) {
  return withWorkspace(req, async (ctx) => {
    const report = await generateEnhancements(ctx.workspaceId);
    return report;
  });
}
