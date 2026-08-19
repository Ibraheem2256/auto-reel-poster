import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function createNotification(
  workspaceId: string,
  type: "ACCOUNT_DISCONNECTED" | "TOKEN_EXPIRED" | "VIDEO_PUBLISHED" | "PUBLISH_FAILED" | "DRIVE_UNAVAILABLE" | "QUEUE_EMPTY" | "COPYRIGHT_ISSUE" | "SYSTEM",
  title: string,
  message?: string
) {
  try {
    const notification = await prisma.notification.create({
      data: { workspaceId, type, title, message },
    });
    // Optional email notification (out of scope for the free-first core; hook point).
    return notification;
  } catch (err) {
    logger.error("notification_create_failed", { workspaceId, error: String(err) });
    return null;
  }
}

export async function markNotificationsRead(workspaceId: string, ids?: string[]) {
  if (ids && ids.length > 0) {
    return prisma.notification.updateMany({
      where: { workspaceId, id: { in: ids } },
      data: { read: true },
    });
  }
  return prisma.notification.updateMany({ where: { workspaceId }, data: { read: true } });
}