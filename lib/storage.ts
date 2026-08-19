import crypto from "crypto";
import { Readable } from "stream";
import { prisma } from "@/lib/prisma";
import { getDriveClient } from "@/lib/google";
import { logger } from "@/lib/logger";
import { TEMP_FILE_TTL_MS, TEMP_FILE_MAX_AGE_MS } from "@/lib/constants";
import type { Video } from "@prisma/client";

// ---------------------------------------------------------------------------
// Zero-persistent policy: by default videos stream directly from Google Drive.
// Temporary object storage (S3-compatible: R2 / Supabase Storage / MinIO) is
// OPTIONAL and only used when a platform cannot accept a streamed multipart
// upload. All temp objects are prefixed with a timestamp and deleted by the
// cleanup cron job once they exceed the TTL. Nothing is ever stored forever.
// ---------------------------------------------------------------------------

const MAX_BUFFER_BYTES = Number(process.env.MAX_VIDEO_BUFFER_BYTES ?? 250 * 1024 * 1024); // 250 MB in-memory cap

const storageConfigured = () =>
  Boolean(
    process.env.STORAGE_ENDPOINT &&
      process.env.STORAGE_ACCESS_KEY &&
      process.env.STORAGE_SECRET_KEY &&
      process.env.STORAGE_BUCKET
  );

const bucket = () => process.env.STORAGE_BUCKET!;

function parseEndpoint(): URL {
  const raw = process.env.STORAGE_ENDPOINT!;
  const url = raw.startsWith("http") ? new URL(raw) : new URL(`https://${raw}`);
  return url;
}

// --- Google Drive streaming -------------------------------------------------

export async function streamVideoFromDrive(
  workspaceId: string,
  driveFileId: string
): Promise<Readable> {
  const drive = await getDriveClient(workspaceId);
  const res = await drive.files.get({ fileId: driveFileId, alt: "media" }, { responseType: "stream" });
  return res.data as unknown as Readable;
}

export async function getVideoBlob(workspaceId: string, driveFileId: string): Promise<Blob> {
  const stream = await streamVideoFromDrive(workspaceId, driveFileId);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > MAX_BUFFER_BYTES) {
      throw new Error("Video exceeds the in-memory upload limit. Enable temporary storage for larger files.");
    }
    chunks.push(new Uint8Array(chunk));
  }
  return new Blob(chunks as unknown as BlobPart[]);
}

// --- Temporary S3-compatible storage ----------------------------------------

interface TempObject {
  key: string;
  expiresAt: Date;
}

export function tempKeyFor(video: Video): string {
  const expiresAt = Date.now() + TEMP_FILE_TTL_MS;
  const safeName = video.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `temp/${expiresAt}/${video.id}/${safeName}`;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function iso8601(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function signAndFetch(
  method: string,
  path: string, // e.g. /bucket/key
  query: string,
  headers: Record<string, string>,
  body?: Readable | Buffer | null
): Promise<Response> {
  const endpoint = parseEndpoint();
  const accessKey = process.env.STORAGE_ACCESS_KEY!;
  const secretKey = process.env.STORAGE_SECRET_KEY!;
  const now = new Date();
  const amzDate = iso8601(now);
  const dateStamp = amzDate.slice(0, 8);
  const region = "auto";
  const service = "s3";

  const host = endpoint.host;
  const canonicalHeaders = `host:${host}\n` + Object.keys(headers).sort().map((k) => `${k}:${headers[k]}`).join("\n") + "\n";
  const signedHeaders = ["host", ...Object.keys(headers).sort()].join(";");
  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, crypto.createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");

  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const url = `${endpoint.origin}${path}${query ? `?${query}` : ""}`;
  return fetch(url, {
    method,
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    },
    body: body as unknown as BodyInit | null,
    // @ts-expect-error Node fetch supports duplex streams
    duplex: body instanceof Readable ? "half" : undefined,
  });
}

export async function uploadVideoToTemp(video: Video, workspaceId: string): Promise<TempObject> {
  if (!storageConfigured()) throw new Error("Temporary storage is not configured (STORAGE_* env vars).");
  const key = tempKeyFor(video);
  const stream = await streamVideoFromDrive(workspaceId, video.driveFileId);
  const res = await signAndFetch(
    "PUT",
    `/${bucket()}/${key}`,
    "",
    { "content-type": video.mimeType || "video/mp4" },
    stream
  );
  if (!res.ok) {
    logger.error("temp_upload_failed", { key, status: res.status });
    throw new Error(`Temporary storage upload failed (${res.status})`);
  }
  return { key, expiresAt: new Date(Date.now() + TEMP_FILE_TTL_MS) };
}

export async function getTempVideoStream(key: string): Promise<Readable> {
  if (!storageConfigured()) throw new Error("Temporary storage is not configured.");
  const res = await signAndFetch("GET", `/${bucket()}/${key}`, "", {});
  if (!res.ok || !res.body) throw new Error(`Temporary storage download failed (${res.status})`);
  return Readable.fromWeb(res.body as unknown as import("stream/web").ReadableStream);
}

export async function deleteTempVideo(key: string): Promise<void> {
  if (!storageConfigured()) return;
  try {
    await signAndFetch("DELETE", `/${bucket()}/${key}`, "", {});
  } catch (err) {
    logger.warn("temp_delete_failed", { key, error: String(err) });
  }
}

export async function cleanupExpiredTempFiles(): Promise<{ deleted: number; checked: number }> {
  if (!storageConfigured()) return { deleted: 0, checked: 0 };
  const prefix = "temp/";
  const now = Date.now();
  const listRes = await signAndFetch(
    "GET",
    `/${bucket()}`,
    `list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`,
    {}
  );
  if (!listRes.ok) {
    logger.error("temp_list_failed", { status: listRes.status });
    return { deleted: 0, checked: 0 };
  }
  const xml = await listRes.text();
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  let deleted = 0;
  for (const key of keys) {
    const match = key.match(/^temp\/(\d+)\//);
    const expiresAt = match ? Number(match[1]) : 0;
    if (expiresAt === 0 || expiresAt + TEMP_FILE_MAX_AGE_MS < now) {
      await deleteTempVideo(key);
      deleted += 1;
    }
  }
  return { deleted, checked: keys.length };
}

// --- Multipart body helper for platform uploads ------------------------------

/**
 * Builds a streaming multipart/form-data body so we never need the whole
 * video in memory. Only the tiny text fields are buffered.
 */
export function buildMultipartBody(
  fields: Record<string, string>,
  fileStream: Readable,
  fileName: string,
  mimeType: string
): { body: Readable; contentType: string } {
  const boundary = `----ArpBoundary${crypto.randomBytes(12).toString("hex")}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="source"; filename="${fileName.replace(/"/g, "")}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    )
  );
  const head = Buffer.concat(chunks);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Readable.from([head, fileStream, tail]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function cleanupAbandonedTempRecords() {
  // Best effort: no DB records reference temp objects, so nothing to do here.
  // Real cleanup is handled by cleanupExpiredTempFiles().
  return 0;
}

export { prisma };