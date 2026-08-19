# Auto Reel Poster

A free-first, web-only SaaS that automatically takes short videos from a **Google Drive folder** and publishes them to **TikTok, YouTube Shorts, Instagram Reels and Facebook Reels** on a daily schedule you choose.

> "I have a Google Drive folder containing my reels. Connect my social media accounts, choose how many videos I want to post every day, and automatically publish the videos for me."

## Core principles

1. **Web application only** — no desktop software, no VPS required.
2. **Google Drive is the source** — users never upload videos to the website.
3. **Zero permanent video storage** — videos are streamed from Drive directly to platform APIs. Temporary files (if any) auto-expire and are deleted. The original Drive file is **never** deleted.
4. **Official APIs + OAuth only** — no browser automation, no stored passwords, no undocumented endpoints.
5. **Free-tier friendly** — targets Vercel Free + Supabase Free + Upstash Free.
6. **Per-platform tracking** — a video can succeed on YouTube and fail on Instagram; only the failed platform is retried.

## How it works

```
Google Drive
    ↓
Detect new video        (Drive scanner, every 5–10 min)
    ↓
Validate video          (format, size, duration, resolution)
    ↓
Create publishing jobs  (scheduler assigns the next free slot)
    ↓
Publish                (per-platform jobs, streamed from Drive)
    ↓
Track status           (per-platform success/failure)
    ↓
Delete temporary data  (nothing is kept)
```

## Tech stack

| Layer        | Choice                              | Free tier |
| ------------ | ----------------------------------- | --------- |
| Frontend     | Next.js + TypeScript + Tailwind     | Vercel Free |
| Backend      | Next.js Route Handlers (serverless) | Vercel Free |
| Database     | PostgreSQL + Prisma                 | Supabase Free |
| Queue/cron   | Upstash Redis/QStash (optional)     | Upstash Free |
| Storage      | None permanent; optional S3 temp bucket with TTL | R2 / Supabase Storage |
| Video source | Google Drive                        | user's Drive |

If any provider changes its free tier, the architecture isolates the concern (see `lib/` modules) so it can be replaced without rewriting the app.

## Quick start (10 steps)

See the detailed guides: **[DATABASE_SETUP.md](DATABASE_SETUP.md)** · **[OAUTH_SETUP.md](OAUTH_SETUP.md)** · **[DEPLOYMENT.md](DEPLOYMENT.md)**

1. **Create the database** — a PostgreSQL instance (e.g. Supabase Free) and run migrations: `npx prisma migrate dev`
2. **Configure Google OAuth** — create a Google Cloud project, enable **Drive API** + **YouTube Data API v3**, add scopes `drive.readonly`, `youtube.upload`, `youtube.readonly`. See `OAUTH_SETUP.md`.
3. **Configure TikTok** — create a TikTok developer app, add scopes `user.info.basic`, `video.publish`. See `OAUTH_SETUP.md`.
4. **Configure Meta** — create a Meta app with Instagram + Facebook products and the right permissions. See `OAUTH_SETUP.md`.
5. **Add environment variables** — copy `.env.example` to `.env` (or set them in your hosting provider).
6. **Run database migrations** — `npx prisma migrate deploy` / `prisma db push`.
7. **Deploy the app** — to Vercel Free (see `DEPLOYMENT.md`).
8. **Configure OAuth redirect URLs** — add your deployed URL to each developer console.
9. **Configure cron jobs** — set up platform cron triggers for the `/api/cron/*` endpoints (scan, publish, check-status, retry, cleanup, token-check).
10. **Connect everything** — register, connect Drive folder, connect accounts, set schedule, enable automation.

## Environment variables

```bash
DATABASE_URL=            # Supabase pooled connection string
DIRECT_URL=              # Supabase direct connection string

NEXTAUTH_SECRET=         # openssl rand -base64 32
NEXTAUTH_URL=            # https://your-app.vercel.app
TOKEN_ENCRYPTION_KEY=    # AES key for encrypted OAuth tokens
OAUTH_STATE_SECRET=      # HMAC key for OAuth state validation

GOOGLE_CLIENT_ID=        # Google Cloud OAuth client
GOOGLE_CLIENT_SECRET=

TIKTOK_CLIENT_KEY=       # TikTok developer app
TIKTOK_CLIENT_SECRET=

META_APP_ID=             # Meta app (Instagram + Facebook)
META_APP_SECRET=

UPSTASH_REDIS_REST_URL=  # optional (rate limiting, not required)
UPSTASH_REDIS_REST_TOKEN=

STORAGE_ENDPOINT=        # optional S3-compatible temp storage (R2/MinIO/Supabase)
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
STORAGE_BUCKET=
STORAGE_PUBLIC_URL=

AI_API_KEY=              # optional OpenAI-compatible API for captions/titles
CRON_SECRET=             # shared secret for /api/cron/* endpoints
SCAN_INTERVAL_MINUTES=10
TIKTOK_PRIVACY_LEVEL=SELF_ONLY   # PUBLIC_TO_EVERYONE requires app approval
```

**Never commit real credentials.** `.env` is git-ignored.

## Project structure

```
app/
  (auth)/login, register      # auth pages
  (dashboard)/                # sidebar-protected pages
    dashboard, queue, calendar, drive, accounts,
    schedules, posts, posts/[id], analytics, settings, admin
  onboarding/                 # first-run wizard
  api/
    auth/register, [...nextauth]
    drive/{connect,callback,scan,status}
    social/[platform]/{connect,callback,disconnect}
    social/accounts
    videos, videos/queue
    schedules, schedules/[id]
    posts, posts/[id], posts/[id]/retry
    automation, settings, analytics, notifications
    webhooks/meta
    cron/[job]                # scan | publish | check-status | retry | cleanup | token-check
    admin/stats
components/                   # shadcn-style UI + dashboard shell
lib/
  prisma.ts, auth.ts, workspace.ts
  drive.ts                    # Drive scanner + validation
  google.ts                   # Google OAuth + Drive/YouTube clients
  scheduler.ts                # timezone-aware scheduling, queue, retry
  storage.ts                  # streaming + temp storage with TTL
  publishers/                 # SocialPublisher abstraction
    types.ts, tokens.ts, meta.ts,
    youtube.ts, instagram.ts, facebook.ts, tiktok.ts, index.ts
  crypto.ts                   # token encryption, OAuth state signing
  rate-limit.ts, audit.ts, notify.ts, ai.ts, api.ts
prisma/schema.prisma          # users, workspaces, drive_sources, videos,
                              # social_accounts, oauth_tokens, schedules,
                              # scheduled_posts, platform_jobs, platform_posts,
                              # notifications, audit_logs, subscriptions
scripts/cron.ts               # local cron runner (self-hosted)
tests/                        # unit tests (vitest)
```

## Scheduler

- **Modes:** fixed times, interval (min gap in hours), platform-specific times.
- **Timezone:** any IANA timezone (default `Asia/Karachi`); timestamps stored in UTC.
- **Queue order:** oldest first / newest first / random.
- **Duplicate protection:** Drive file ID + modified time. Same file is never processed twice unless changed.
- **Retry:** exponential backoff `5 min → 30 min → 2 h → failed`; permanent errors never retry; successful platforms are never re-uploaded.
- **Pause/resume:** `PAUSE ALL POSTING` stops new jobs instantly. Existing data stays safe.

## Testing

```bash
npm test           # vitest unit tests (scheduling, crypto, validation, captions)
npm run typecheck  # tsc --noEmit
```

## Deployment

Vercel Free is the recommended target. Platform cron triggers (e.g. Vercel Cron, QStash) call the `/api/cron/*` endpoints with the `x-cron-secret` header. See **[DEPLOYMENT.md](DEPLOYMENT.md)**.

## Important API notes

- **TikTok:** unapproved apps can only publish with `privacy_level = SELF_ONLY`. Public posting requires submitting the app for review with the `video.publish` permission.
- **Instagram:** automatic publishing requires a **Business/Creator account linked to a Facebook Page** and app approval for the `instagram_content_publish` permission. Ineligible accounts see a clear error, never a fake success.
- **YouTube:** uploads are created as `private` videos so nothing is publicly visible before you choose to publish. Shorts detection follows YouTube's own rules (vertical, ≤ 60 s).
- Quotas and rate limits are handled gracefully; errors surface on each platform card with a "Reconnect" action.

## License

Private project. Do not redistribute credentials or production secrets.