# OAuth Setup — Auto Reel Poster

This guide covers the four developer applications needed. Every connection uses official OAuth — no passwords are ever stored.

> **Redirect URL**: every app below needs your OAuth redirect. For local dev:
> `http://localhost:3000/api/...` — for production:
> `https://your-app.vercel.app/api/...`

---

## 1. Google (Drive + YouTube + Google sign-in)

One Google Cloud project powers three features: Google Drive folder access, YouTube uploads, and optional Google sign-in.

1. Go to https://console.cloud.google.com → create a project.
2. **APIs & Services → Library** → enable:
   - **Google Drive API**
   - **YouTube Data API v3**
3. **APIs & Services → OAuth consent screen** → External → fill app name, user support email, developer email.
4. Add scopes (under "Add or remove scopes"):
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`
   - (optional sign-in) `openid`, `email`, `profile`
5. Add yourself as a **test user** (consent screen → Audience → Test users) while the app is unverified.
6. **APIs & Services → Credentials → Create credentials → OAuth client ID** → type **Web application**.
7. Add authorized redirect URIs:
   - `http://localhost:3000/api/drive/callback`
   - `http://localhost:3000/api/social/youtube/callback`
   - `https://your-app.vercel.app/api/drive/callback`
   - `https://your-app.vercel.app/api/social/youtube/callback`
   - (optional sign-in) `http://localhost:3000/api/auth/callback/google` and the production equivalent
8. Copy the client ID + secret into `.env`:

```env
GOOGLE_CLIENT_ID="....apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="...."
```

> Unverified apps work for test users. For public launch, complete the OAuth verification process (requires privacy policy + domain verification).

---

## 2. TikTok (Content Posting API)

1. Go to https://developers.tiktok.com → create an app.
2. Add the **Login Kit** and the **Content Posting API** products.
3. Required scopes: `user.info.basic`, `video.publish`.
4. Set the redirect URL: `https://your-app.vercel.app/api/social/tiktok/callback` (+ localhost for dev).
5. Copy the **Client Key** and **Client Secret** into `.env`:

```env
TIKTOK_CLIENT_KEY="..."
TIKTOK_CLIENT_SECRET="..."
```

### Important limitations

- **Unapproved apps** can only publish videos with `privacy_level = SELF_ONLY` (set via `TIKTOK_PRIVACY_LEVEL`). The video is posted to the user's account but not public.
- To publish **publicly**, submit the app for review with the `video.publish` permission and explain your use case. Expect manual review.
- The app must complete **monetization/content review** before `PUBLIC_TO_EVERYONE` works.
- The app never fakes success: if the permission is missing, the job fails with a clear error.

---

## 3. Meta (Instagram Reels + Facebook Reels)

One Meta app powers both platforms.

1. Go to https://developers.facebook.com → create an app → type **Business**.
2. Add products: **Instagram** (Instagram Graph API) and **Facebook Login for Business** (or Pages API product).
3. **App settings → Basic**: copy App ID and App Secret into `.env`:

```env
META_APP_ID="..."
META_APP_SECRET="..."
```

4. **App Review** → add these permissions for live use:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_manage_posts`
   - `pages_read_engagement`
5. **Valid OAuth Redirect URIs**:
   - `https://your-app.vercel.app/api/social/instagram/callback`
   - `https://your-app.vercel.app/api/social/facebook/callback`
   - localhost equivalents
6. Under **Instagram → API setup**: choose the app mode ("Development" for testing with admin accounts).

### Requirements

- **Instagram**: the connected account **must be a Business or Creator account linked to a Facebook Page** that you manage, and the app must have `instagram_content_publish` (via app review). If ineligible, the app shows:
  > "Instagram cannot be connected for automatic publishing. Reason: Account/API permission requirements are not satisfied."
- **Facebook**: the user selects a Page they manage; reels publish to that Page.
- Tokens are exchanged for long-lived (~60 days) page tokens automatically.

---

## 4. YouTube (already covered by Google, but quotas)

The YouTube Data API v3 free quota is 10,000 units/day. A `videos.insert` upload costs 1600 units, so roughly **6 uploads/day** on the free quota. Plan your `postsPerDay` accordingly or add a YouTube quota package later. The architecture keeps the quota limit in one constant, so it can be raised without code changes.

---

## Webhooks (optional)

- **Meta webhooks** (`/api/webhooks/meta`) verify the `X-Hub-Signature-256` HMAC with `META_APP_SECRET`. Configure the webhook endpoint in the Meta app dashboard if you want platform status events.
- Webhooks are never trusted without signature verification.

---

## Verifying a connection locally

1. `npm run dev`
2. Register/login at `http://localhost:3000`
3. Open **Drive Folder** → paste a folder link → connect → authorize in Google
4. Open **Connected Accounts** → connect each platform
5. Watch `npm run dev` logs for `*_connected` entries