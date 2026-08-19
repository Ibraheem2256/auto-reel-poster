import { prisma } from "@/lib/prisma";
import { getDriveClient } from "@/lib/google";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/logger";
import { SUPPORTED_EXTENSIONS, VIDEO_LIMITS } from "@/lib/constants";
import { getExtension, isVideoMime, getErrorMessage } from "@/lib/utils";
import type { DriveSource, VideoStatus } from "@prisma/client";

const FIELDS = "id,name,mimeType,size,modifiedTime,thumbnailLink,trashed,videoMediaMetadata(durationMillis,width,height)";
const QUERY_FILTERS = "trashed = false and mimeType != 'application/vnd.google-apps.folder'";

export async function verifyDriveFolder(workspaceId: string, folderId: string) {
  const drive = await getDriveClient(workspaceId);
  try {
    const res = await drive.files.get({
      fileId: folderId,
      fields: "id,name,mimeType",
      supportsAllDrives: true,
    });
    if (!res.data || res.data.mimeType !== "application/vnd.google-apps.folder") {
      throw new AppError("NOT_A_FOLDER", "The provided link is not a Google Drive folder.", { status: 400 });
    }
    return { folderId: res.data.id!, name: res.data.name ?? "Drive folder" };
  } catch (err) {
    const message = getErrorMessage(err);
    if (message.includes("404") || message.toLowerCase().includes("not found")) {
      throw new AppError("FOLDER_NOT_FOUND", "Folder not found or not shared with the connected Google account.", {
        status: 404,
      });
    }
    if (message.toLowerCase().includes("permission")) {
      throw new AppError("FOLDER_ACCESS_DENIED", "The folder is not shared with the connected Google account.", {
        status: 403,
      });
    }
    throw err;
  }
}

export interface DriveScanResult {
  found: number;
  newVideos: number;
  updated: number;
  deleted: number;
  invalid: number;
}

export async function scanDriveSource(
  workspaceId: string,
  source: DriveSource,
  drive: ReturnType<typeof getDriveClient> extends Promise<infer T> ? T : never
): Promise<DriveScanResult> {
  const result: DriveScanResult = { found: 0, newVideos: 0, updated: 0, deleted: 0, invalid: 0 };
  const seenIds = new Set<string>();

  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${source.folderId}' in parents and ${QUERY_FILTERS}`,
      fields: `nextPageToken, files(${FIELDS})`,
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const files = res.data.files ?? [];
    for (const file of files) {
      if (!file.id) continue;
      seenIds.add(file.id);
      await upsertVideo(workspaceId, source.id, file as DriveFileShape, result);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  // Mark files that disappeared from the folder.
  const tracked = await prisma.video.findMany({
    where: { workspaceId, driveSourceId: source.id, driveFileId: { notIn: [...seenIds] } },
    select: { id: true, driveFileId: true, status: true },
  });
  for (const video of tracked) {
    await prisma.video.update({
      where: { id: video.id },
      data: { status: "SKIPPED" as VideoStatus },
    });
    await prisma.platformJob.updateMany({
      where: { videoId: video.id, status: { in: ["PENDING", "RETRYING"] } },
      data: { status: "CANCELLED" },
    });
    result.deleted += 1;
  }

  await prisma.driveSource.update({
    where: { id: source.id },
    data: { lastScanAt: new Date(), status: "CONNECTED", lastError: null },
  });
  logger.info("drive_scan_complete", { workspaceId, folderId: source.folderId, ...result });
  return result;
}

interface DriveFileShape {
  id: string;
  name: string;
  mimeType?: string | null;
  size?: string | null;
  modifiedTime?: string | null;
  thumbnailLink?: string | null;
  trashed?: boolean | null;
  videoMediaMetadata?: { durationMillis?: string | number | null; width?: number | null; height?: number | null } | null;
}

async function upsertVideo(
  workspaceId: string,
  driveSourceId: string,
  file: DriveFileShape,
  result: DriveScanResult
): Promise<void> {
  result.found += 1;
  const ext = getExtension(file.name);
  const mime = file.mimeType ?? "application/octet-stream";
  const isVideo =
    SUPPORTED_EXTENSIONS.includes(ext) && (isVideoMime(mime) || mime === "application/octet-stream");
  if (!isVideo) return;

  const existing = await prisma.video.findUnique({ where: { driveFileId: file.id } });

  if (existing) {
    const modifiedChanged = file.modifiedTime ? new Date(file.modifiedTime).getTime() !== new Date(existing.modifiedTime ?? 0).getTime() : false;
    if (!modifiedChanged && existing.status !== "SKIPPED") return; // unchanged, don't reprocess
    result.updated += 1;
  } else {
    result.newVideos += 1;
  }

  const validation = validateVideoFile(file, ext);

  await prisma.video.upsert({
    where: { driveFileId: file.id },
    create: {
      workspaceId,
      driveSourceId,
      driveFileId: file.id,
      fileName: file.name,
      mimeType: mime,
      fileSize: file.size ? BigInt(file.size) : null,
      modifiedTime: file.modifiedTime ? new Date(file.modifiedTime) : null,
      thumbnailUrl: file.thumbnailLink ?? null,
      durationMs: Number(file.videoMediaMetadata?.durationMillis ?? 0) || null,
      width: file.videoMediaMetadata?.width ?? null,
      height: file.videoMediaMetadata?.height ?? null,
      status: validation.ok ? "VALIDATED" : "INVALID",
      invalidReason: validation.ok ? null : validation.reason,
    },
    update: {
      fileName: file.name,
      mimeType: mime,
      fileSize: file.size ? BigInt(file.size) : null,
      modifiedTime: file.modifiedTime ? new Date(file.modifiedTime) : null,
      thumbnailUrl: file.thumbnailLink ?? null,
      durationMs: Number(file.videoMediaMetadata?.durationMillis ?? 0) || null,
      width: file.videoMediaMetadata?.width ?? null,
      height: file.videoMediaMetadata?.height ?? null,
      status: validation.ok ? "VALIDATED" : "INVALID",
      invalidReason: validation.ok ? null : validation.reason,
      detectedAt: new Date(),
    },
  });

  if (!validation.ok) result.invalid += 1;
}

export function validateVideoFile(
  file: DriveFileShape,
  ext: string
): { ok: true } | { ok: false; reason: string } {
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return { ok: false, reason: `Unsupported format .${ext}. Supported: mp4, mov, m4v, webm` };
  }
  const size = file.size ? Number(file.size) : null;
  if (size && size > VIDEO_LIMITS.maxSizeBytes) {
    return { ok: false, reason: "File is larger than the 1 GB limit" };
  }
  const duration = Number(file.videoMediaMetadata?.durationMillis ?? 0);
  if (duration > 0) {
    if (duration < VIDEO_LIMITS.minDurationMs) {
      return { ok: false, reason: "Video is shorter than 5 seconds" };
    }
    if (duration > VIDEO_LIMITS.maxDurationMs) {
      return { ok: false, reason: "Video is longer than 10 minutes" };
    }
  }
  const { width, height } = file.videoMediaMetadata ?? {};
  if (width && height) {
    if (width < VIDEO_LIMITS.minWidth || height < VIDEO_LIMITS.minHeight) {
      return { ok: false, reason: `Resolution ${width}x${height} is too low (min 320x320)` };
    }
  }
  return { ok: true };
}

export async function scanAllSources() {
  const sources = await prisma.driveSource.findMany({ where: { status: "CONNECTED" } });
  let scanned = 0;
  let failed = 0;
  for (const source of sources) {
    const workspace = await prisma.workspace.findUnique({ where: { id: source.workspaceId } });
    if (!workspace) continue;
    try {
      const drive = await getDriveClient(source.workspaceId);
      await scanDriveSource(source.workspaceId, source, drive);
      scanned += 1;
    } catch (err) {
      failed += 1;
      logger.error("drive_scan_failed", { workspaceId: source.workspaceId, folderId: source.folderId, error: getErrorMessage(err) });
      await prisma.driveSource.update({
        where: { id: source.id },
        data: { status: "ERROR", lastError: getErrorMessage(err).slice(0, 500) },
      });
      const isAuthError = getErrorMessage(err).includes("auth") || getErrorMessage(err).includes("401") || getErrorMessage(err).includes("expired");
      if (isAuthError) {
        await prisma.notification.create({
          data: {
            workspaceId: source.workspaceId,
            type: "DRIVE_UNAVAILABLE",
            title: "Drive connection needs attention",
            message: "The Google Drive connection expired or was revoked. Reconnect it to keep scanning.",
          },
        });
      }
    }
  }
  return { scanned, failed };
}