# Deployment — Auto Reel Poster

Target: **Vercel Free** (frontend + serverless API), **Supabase Free** (database), optional **Upstash Free** (rate limiting/queue). No VPS required.

---

## 1. Deploy to Vercel

1. Push this repository to GitHub.
2. Go to https://vercel.com/new → import the repo.
3. Framework preset: **Next.js** (auto-detected).
4. Add the environment variables from `.env.example` (all of them, with real values).
5. Deploy.

Your app is live at `https://your-app.vercel.app`.

### Custom domain (optional)

Settings → Domains → add your domain. Not required — the free subdomain works fine.

---

## 2. Database

Follow [DATABASE_SETUP.md](DATABASE_SETUP.md) for Supabase. Then:

```bash
npx prisma migrate deploy   # applies migrations to the production database
```

(Set `DATABASE_URL` + `DIRECT_URL` locally to the production values first, or run the migration from a GitHub Action.)

---

## 3. OAuth redirect URLs

After deployment, add these to every developer console (see [OAUTH_SETUP.md](OAUTH_SETUP.md)):

```
https://your-app.vercel.app/api/drive/callback
https://your-app.vercel.app/api/social/youtube/callback
https://your-app.vercel.app/api/social/instagram/callback
https://your-app.vercel.app/api/social/facebook/callback
https://your-app.vercel.app/api/social/tiktok/callback
```

---

## 4. Cron / scheduled jobs

The app is fully serverless. Scheduled work runs via HTTP cron triggers that call the serverless functions with the `x-cron-secret` header (`CRON_SECRET` env var).

| Endpoint | Frequency | Purpose |
| --- | --- | --- |
| `POST /api/cron/scan` | every 5–10 min | Scan all connected Drive folders, queue new videos, assign slots |
| `POST /api/cron/publish` | every 1 min | Publish due platform jobs |
| `POST /api/cron/check-status` | every 5 min | Resolve in-flight jobs stuck for > 30 min |
| `POST /api/cron/retry` | every 5 min | Process failed jobs whose backoff window elapsed |
| `POST /api/cron/cleanup` | hourly | Delete expired temp files + stale jobs |
| `POST /api/cron/token-check` | daily | Refresh expiring OAuth tokens |

### Option A — Vercel Cron (easiest)

Add to `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/scan", "schedule": "*/10 * * * *" },
    { "path": "/api/cron/publish", "schedule": "* * * * *" },
    { "path": "/api/cron/check-status", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/retry", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/cleanup", "schedule": "0 * * * *" },
    { "path": "/api/cron/token-check", "schedule": "0 3 * * *" }
  ]
}
```

> Vercel Cron is available on Hobby (2 daily executions) and Pro plans. For free-tier, Hobby's 2/day limit is not enough for a 5-minute scan — use Option B.

### Option B — Upstash QStash (free tier recommended)

1. Create a free Upstash account → QStash.
2. Create a schedule per endpoint:

```bash
# one-time setup example (via QStash console or API)
POST https://qstash.upstash.io/v1/schedules
Authorization: Bearer <QSTASH_TOKEN>
{
  "destination": "https://your-app.vercel.app/api/cron/scan",
  "cron": "*/10 * * * *",
  "header": { "x-cron-secret": "<CRON_SECRET>" }
}
```

3. Repeat for each job with the frequencies above. QStash free tier allows ~10,000 requests/day — plenty.

### Option C — Self-hosted / dev

For a local or always-on machine, use the built-in runner:

```bash
npm run cron:scan        # or publish / check / retry / cleanup / tokencheck
```

Wire it into `crontab` on any free machine:

```
*/10 * * * * cd /path/to/app && npm run cron:scan
* * * * *    cd /path/to/app && npm run cron:publish
```

> Serverless note: cron functions must be **idempotent**. Jobs are claimed with `updateMany` (status → PROCESSING), so overlapping invocations never double-publish.

---

## 5. Temporary file storage (optional)

By default **no files are stored anywhere** — videos stream from Google Drive directly into platform uploads (YouTube supports streamed uploads; Meta accepts multipart streams; TikTok uses chunked uploads).

For very large videos (> ~250 MB in-memory cap) configure an S3-compatible bucket with TTL:

```env
STORAGE_ENDPOINT="https://<account>.r2.cloudflarestorage.com"   # Cloudflare R2 free 10GB
STORAGE_ACCESS_KEY="..."
STORAGE_SECRET_KEY="..."
STORAGE_BUCKET="temp-videos"
STORAGE_PUBLIC_URL=""   # optional, only if you want TikTok PULL_FROM_URL mode
```

- Every object is stored under `temp/<expiry-timestamp>/<video-id>/<name>`.
- The hourly `/api/cron/cleanup` deletes everything older than the TTL (1 hour default, hard cutoff 6 hours).
- Nothing is ever archived.

---

## 6. Production checklist

- [ ] `NEXTAUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `OAUTH_STATE_SECRET`, `CRON_SECRET` are long random strings
- [ ] OAuth redirect URLs deployed in all 4 developer consoles
- [ ] Supabase: network restrictions allow Vercel IPs (or use the pooler, which is open by default)
- [ ] Cron triggers configured and verified (`/api/cron/scan` returns `{"ok":true}`)
- [ ] `npm test` and `npm run typecheck` pass
- [ ] First real user went through onboarding end-to-end
- [ ] `.env` values match `.env.example` keys (no missing vars)

---

## 7. Scale-up path (when free tiers run out)

| Free | Paid upgrade |
| --- | --- |
| Supabase Free (500 MB) | Supabase Pro |
| Vercel Hobby | Vercel Pro |
| Upstash Free | Upstash Pro |
| R2 free tier | R2 pay-as-you-go |

Each layer is behind a small interface (`lib/prisma.ts`, `lib/rate-limit.ts`, `lib/storage.ts`, `lib/publishers/`), so swaps don't require rewriting the app.