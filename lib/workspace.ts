import { prisma } from "@/lib/prisma";
import type { Workspace } from "@prisma/client";

export async function createDefaultWorkspace(userId: string): Promise<Workspace> {
  return prisma.workspace.create({
    data: {
      ownerId: userId,
      captions: { default: "", useSameEverywhere: true, platforms: {} },
      hashtags: { default: [], platforms: {} },
    },
  });
}

export async function getWorkspace(userId: string, workspaceId?: string) {
  const id = workspaceId || (await getDefaultWorkspaceId(userId));
  if (!id) return null;
  return prisma.workspace.findFirst({
    where: { id, ownerId: userId },
    include: {
      driveSources: true,
      socialAccounts: true,
      schedules: true,
      subscriptions: true,
    },
  });
}

export async function getDefaultWorkspaceId(userId: string): Promise<string | null> {
  const ws = await prisma.workspace.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return ws?.id ?? null;
}

export async function requireWorkspace(userId: string, workspaceId?: string) {
  const ws = await getWorkspace(userId, workspaceId);
  if (!ws) throw new Error("No workspace found for user");
  return ws;
}