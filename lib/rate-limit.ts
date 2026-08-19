import { Redis } from "@upstash/redis";

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

export const redis: Redis | null =
  redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

/**
 * Sliding-window rate limiter.
 * Uses Upstash Redis when configured; falls back to an in-memory limiter
 * (acceptable for single-instance dev, not for multi-instance production).
 */
const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ ok: boolean; retryAfter?: number }> {
  if (redis) {
    const res = await redis
      .multi()
      .incr(`rl:${key}`)
      .expire(`rl:${key}`, windowSeconds, "NX")
      .exec();
    const count = Number(res?.[0] ?? 0);
    const ttl = Number(res?.[1] ?? windowSeconds);
    return { ok: count <= limit, retryAfter: Math.max(1, ttl) };
  }

  const now = Date.now();
  const bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { ok: true };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true };
}