# Database Setup — Auto Reel Poster

Uses **PostgreSQL** via **Prisma ORM**. Recommended free provider: **Supabase**.

## 1. Create a Supabase project

1. Sign up at https://supabase.com and create a new project (choose a region close to you).
2. Wait for the database to be provisioned.

## 2. Get the connection strings

1. In Supabase, go to **Project Settings → Database → Connection string**.
2. Copy two values:
   - **Pooled** (with `?pgbouncer=true&connection_limit=1`) → `DATABASE_URL`
   - **Direct** (plain) → `DIRECT_URL`

Example:

```env
DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres"
```

> Prisma migrations must run against `DIRECT_URL`; the app runtime should use the pooled `DATABASE_URL`.

## 3. Configure `.env`

```env
DATABASE_URL="..."
DIRECT_URL="..."
```

## 4. Create the schema

With a live database available:

```bash
# Local dev — create schema and apply
npx prisma migrate dev --name init

# Or, if you prefer not to create migration files yet
npx prisma db push
```

For production:

```bash
npx prisma migrate deploy
```

## 5. Seed (optional)

Creates an admin account (`admin@example.com` / `admin123456` — change immediately):

```bash
npm run db:seed
```

## 6. Inspect

```bash
npm run db:studio
```

## Schema overview

The database stores **metadata only — never video files**.

| Table | Purpose |
| --- | --- |
| `users` | App accounts (email/password or Google sign-in) |
| `workspaces` | Per-user config: timezone, queue order, captions, hashtags, automation switches |
| `drive_sources` | Connected Google Drive folders |
| `videos` | Drive file metadata (ID, name, size, mime, modified time, validation result) — no binary |
| `social_accounts` | Connected TikTok/YouTube/Instagram/Facebook accounts |
| `oauth_tokens` | Encrypted access/refresh tokens per platform |
| `schedules` | Posting schedule definitions (mode, times, platforms) |
| `scheduled_posts` | One row per video→time assignment |
| `platform_jobs` | Per-platform publishing jobs with status, retries, errors |
| `platform_posts` | Confirmed platform post IDs |
| `notifications` | In-app alerts |
| `audit_logs` | Security/action trail |
| `subscriptions` | Plan/status (FREE) |

## Notes

- Tokens are encrypted with AES-256-GCM using `TOKEN_ENCRYPTION_KEY` (falls back to `NEXTAUTH_SECRET`).
- No video binary column exists anywhere in the schema.