import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export async function audit(opts: {
  workspaceId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        workspaceId: opts.workspaceId ?? null,
        userId: opts.userId ?? null,
        action: opts.action,
        entityType: opts.entityType,
        entityId: opts.entityId,
        metadata: opts.metadata as Prisma.InputJsonValue | undefined,
        ip: opts.ip ?? null,
      },
    });
  } catch {
    // Audit failures must never break the main flow.
  }
}