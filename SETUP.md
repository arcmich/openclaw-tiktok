# openclaw-tiktok — Setup Guide

TikTok integration plugin for OpenClaw. Gives your bot full control over a TikTok account:

- **Post videos** — from a URL (fast) or chunked file upload
- **Post photos** — single image or slideshow up to 35 images
- **Manage feed** — list videos, query by ID, check post status
- **Creator info** — privacy options, feature limits, max video duration
- **Token management** — automatic 24-hour token refresh
- **Research tools** *(optional)* — search public videos, read comments

---

## Prerequisites

| Requirement | Notes |
|---|---|
| TikTok **Business** or **Creator** account | Personal accounts have reduced API access |
| TikTok Developer App | Free at [developers.tiktok.com](https://developers.tiktok.com) |
| Node.js 22.16+ | OpenClaw requirement |

---

## 1 — Create a TikTok Developer App

1. Go to [developers.tiktok.com](https://developers.tiktok.com) and sign in.
2. Click **Manage Apps → Create an app**.
3. Fill in app name, description, and category.
4. Under **Products**, add:
   - **Login Kit** (for OAuth)
   - **Content Posting API**
   - **Display API** (for user info + video list)
   - **Research API** *(optional — requires separate approval)*
5. Under **Redirect URIs**, add the URL where you'll handle the OAuth callback
   (e.g. `http://localhost:3000/callback` for local setup).
6. Copy your **Client Key** and **Client Secret** from App Detail.

---

## 2 — Request Required Permissions (Scopes)

In your TikTok App settings, request these scopes:

| Scope | Used for |
|---|---|
| `user.info.basic` | `tiktok_get_user_info` |
| `user.info.profile` | bio, verification status |
| `user.info.stats` | follower/following/likes counts |
| `video.list` | `tiktok_list_videos`, `tiktok_get_video` |
| `video.publish` | all posting tools + `tiktok_get_creator_info` |
| `research.data.basic` | *(optional)* `tiktok_search_videos`, `tiktok_get_video_comments` |

---

## 3 — Get an OAuth Access Token

TikTok uses standard OAuth 2.0 PKCE. Run this one-time flow to get your tokens:

### Step A — Build the authorization URL

```
https://www.tiktok.com/v2/auth/authorize/?
  client_key=YOUR_CLIENT_KEY
  &scope=user.info.basic,user.info.profile,user.info.stats,video.list,video.publish
  &response_type=code
  &redirect_uri=YOUR_REDIRECT_URI
  &state=random-csrf-string
```

Open this URL in a browser, sign in to TikTok, and authorize the app. TikTok
redirects to your `redirect_uri` with a `code` query parameter.

### Step B — Exchange the code for tokens

```bash
curl -X POST https://open.tiktokapis.com/v2/oauth/token/ \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_key=YOUR_CLIENT_KEY" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=CODE_FROM_STEP_A" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=YOUR_REDIRECT_URI"
```

Response:
```json
{
  "data": {
    "access_token": "act.example...",
    "expires_in": 86400,
    "refresh_token": "rft.example...",
    "refresh_expires_in": 31536000,
    "open_id": "12345..."
  }
}
```

Save `access_token`, `refresh_token`, and `open_id` — you'll need all three.

---

## 4 — Install the plugin

```bash
openclaw plugin install /path/to/openclaw-tiktok
# or from npm once published:
openclaw plugin install openclaw-tiktok
```

---

## 5 — Configure the plugin

Add a `tiktok` section to your `openclaw.json`:

```jsonc
{
  "plugins": {
    "tiktok": {
      "clientKey": "YOUR_CLIENT_KEY",
      "clientSecret": "YOUR_CLIENT_SECRET",
      "accessToken": "act.example...",
      "refreshToken": "rft.example...",
      "openId": "12345...",
      "defaultPrivacyLevel": "SELF_ONLY",
      "enableResearchTools": false,
      "pollIntervalMs": 3000,
      "pollTimeoutMs": 120000
    }
  }
}
```

> **Security tip:** Keep `clientSecret`, `accessToken`, and `refreshToken` out of
> version control. Use environment variable substitution if your OpenClaw setup supports it.

---

## 6 — Available agent tools

### Core tools (always available)

| Tool | What it does |
|---|---|
| `tiktok_get_user_info` | Profile: display name, avatar, bio, follower/like/video counts |
| `tiktok_get_creator_info` | Available privacy levels, feature toggles, max video duration |
| `tiktok_list_videos` | Paginated list of the account's videos with metrics |
| `tiktok_get_video` | Full details for up to 20 specific videos by ID |
| `tiktok_post_video_url` | Kick off a video post from a public URL (non-blocking) |
| `tiktok_post_video_and_wait` | Post a video from URL and wait for publish confirmation |
| `tiktok_post_photo` | Post 1–35 photos as a slideshow |
| `tiktok_get_publish_status` | Check processing status for a pending post |
| `tiktok_refresh_token` | Force-refresh the access token (usually automatic) |

### Research tools (require `enableResearchTools: true` + TikTok Research API approval)

| Tool | What it does |
|---|---|
| `tiktok_get_video_comments` | Read comments on any public video |
| `tiktok_search_videos` | Search public videos by keywords and date range |

---

## 7 — Privacy levels

| Value | Visible to |
|---|---|
| `PUBLIC_TO_EVERYONE` | All TikTok users |
| `MUTUAL_FOLLOW_FRIENDS` | Mutual followers only |
| `FOLLOWER_OF_CREATOR` | Your followers only |
| `SELF_ONLY` | Only you — **use this for testing** |

Set `defaultPrivacyLevel` in config to apply a default to every post.

---

## 8 — Token refresh

Access tokens expire every **24 hours**. The plugin refreshes automatically using
the stored refresh token (valid 365 days). If the refresh token also expires, run
the OAuth flow again from Step 3 to get new tokens.

---

## 9 — Rate limits

| Endpoint | Limit |
|---|---|
| `/v2/post/publish/video/init/` | 6 requests/min per user token |
| Most other endpoints | Consult TikTok developer docs for current quotas |

---

## 10 — Content policies

- All posts from unaudited apps are forced to **private** until your app passes
  TikTok's content review. Test with `defaultPrivacyLevel: "SELF_ONLY"` and apply
  for production access once your integration is verified.
- Videos must comply with [TikTok Community Guidelines](https://www.tiktok.com/community-guidelines).

## 11 — Optional TweetClaw source packets

When a TikTok brief starts from public X/Twitter conversation context, keep the
source collection separate from TikTok publishing:

1. Use TweetClaw to export the relevant public posts, replies, author handles,
   URLs, and visible engagement metrics as an evidence packet.
2. Summarize that packet into the creative brief used by this TikTok plugin.
3. Review the brief and generated media before calling any posting tool.
4. Keep `defaultPrivacyLevel: "SELF_ONLY"` for test publishes until the TikTok
   account and app review are production-ready.

TweetClaw does not replace TikTok OAuth, TikTok permissions, or this plugin's
privacy controls. Treat it as X/Twitter source evidence for ideation and review,
not as authority to publish TikTok content automatically.
