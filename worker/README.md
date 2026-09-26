# Steam proxy (Cloudflare Worker)

Leetify's public API doesn't return a player avatar, and the widget is a static
GitHub Pages site, so it can't call Steam's Web API itself — that API needs a
secret key and doesn't send CORS headers. This tiny Worker keeps the key
server-side (adding CORS) and answers three lookups:

- **Avatar** — resolves a Steam64 ID to a Steam avatar URL.
- **Vanity URL** — resolves a custom `steamcommunity.com/id/<name>` profile link
  to a Steam64 ID, so the customizer can accept those links directly.
- **Live status** — reports whether a channel is currently live. This lives in a
  set of separate Workers, one per platform (Twitch, YouTube, Kick), documented
  further down.

It's **optional**. Without it, the widget simply doesn't show an avatar, the
customizer only accepts a Steam64 ID or a `steamcommunity.com/profiles/…` link
(both of which need no server call) rather than custom `/id/…` links, and the
live-session W/L falls back to the normal rolling-window W/L.

## Deploy

1. **Get a Steam Web API key** (free): https://steamcommunity.com/dev/apikey

2. **Deploy the Worker** with [Wrangler](https://developers.cloudflare.com/workers/wrangler/):

   ```bash
   cd worker
   npx wrangler deploy
   ```

   (Or create a Worker in the Cloudflare dashboard and paste in
   `steam-avatar-proxy.js`.)

3. **Add your key as a secret** — never commit it:

   ```bash
   npx wrangler secret put STEAM_API_KEY
   ```

   (Dashboard equivalent: your Worker → Settings → Variables and Secrets → add a
   **secret** named `STEAM_API_KEY`.)

4. **Point the widget at the Worker.** Note the Worker's URL (e.g.
   `https://cs2-steam-avatar-proxy.<you>.workers.dev`) and set it as the build
   variable `VITE_AVATAR_PROXY_URL`:

   - **Local dev:** add it to `.env.local`.
   - **Deployed site:** add a repository **variable** (or secret)
     `VITE_AVATAR_PROXY_URL` under Settings → Secrets and variables → Actions.
     The URL is not sensitive — it gets inlined into the public bundle — so a
     plain repository *variable* is fine.

That's it. The widget calls `GET {VITE_AVATAR_PROXY_URL}?steam64_id=<id>` and
renders the returned avatar. The **Steam key stays on Cloudflare** and never
reaches the browser.

# Leetify proxy (Cloudflare Worker)

Powers **Premier mode** (the default `PREMIER | FACEIT` toggle). Leetify's public
API (`api-public.cs-prod.leetify.com`) sends **no CORS headers**, so the static
site can't read its responses from a browser — the fetch is blocked before any
HTTP status is seen and surfaces as **"Failed to fetch"** (the same in OBS's
Chromium browser source). This Worker (`leetify-proxy.js`) sits in front of the
two endpoints the Premier path needs, adds CORS so the browser can read them,
and keeps the (optional) Leetify API key server-side:

- `GET ?steam64_id=<id>` → the profile payload (identity, ranks, recent matches).
- `GET ?steam64_id=<id>&matches=1` → the match list (per-match kills/deaths).

It's effectively **required for Premier mode in a browser**. Without it the
widget falls back to calling Leetify directly, which works from non-browser
tooling but a browser blocks — so Premier mode shows "Failed to fetch".

## Deploy

1. **(Optional) get a Leetify API key** from <https://leetify.com> — it only
   raises rate limits; the public API works without one.

2. **Deploy the Worker** with [Wrangler](https://developers.cloudflare.com/workers/wrangler/):

   ```bash
   cd worker
   npx wrangler deploy --config wrangler.leetify.toml
   ```

   (Or create a Worker in the Cloudflare dashboard and paste in `leetify-proxy.js`.)

3. **(Optional) add your key as a secret** — never commit it:

   ```bash
   npx wrangler secret put LEETIFY_KEY --config wrangler.leetify.toml
   ```

   (Dashboard equivalent: your Worker → Settings → Variables and Secrets → add a
   **secret** named `LEETIFY_KEY`.)

4. **Point the widget at the Worker** via a repository **variable** (or
   `.env.local` for local dev) named `VITE_LEETIFY_PROXY_URL`. The URL is not
   sensitive — it gets inlined into the public bundle — so a plain repository
   *variable* is fine. When the proxy is used the API key lives **only on the
   Worker**, never in the browser bundle.

# FACEIT proxy (Cloudflare Worker)

Powers the widget's **FACEIT mode** (the `PREMIER | FACEIT` toggle in the
customizer). FACEIT's Data API needs a secret `Authorization: Bearer <key>`
header and sends no CORS headers, so — like the Steam key — it can't be called
from the static site. This Worker (`faceit-proxy.js`) keeps the key server-side
and, in a single request, resolves a Steam64 ID to everything the overlay needs
(a CS2 player's FACEIT `game_player_id` is their Steam ID, so the widget keeps
one identity input): ELO + skill level, lifetime stats (K/D, win rate, ADR, HS%),
the recent
match list with per-match kills/deaths, and — for Challenger-tier players — the
leaderboard position. FACEIT has no batched per-match-stats endpoint, so this
chaining is done on the Worker, keeping the browser to one call.

Unlike the Steam proxy, this one is **required for FACEIT mode** — without it the
customizer's FACEIT option has no data source. Premier (Leetify) mode is
unaffected and needs none of this.

## Deploy

1. **Get a FACEIT Data API key** (free): create an app at
   <https://developers.faceit.com/> (App Studio) and generate a **server-side**
   API key.

2. **Deploy the Worker** with [Wrangler](https://developers.cloudflare.com/workers/wrangler/):

   ```bash
   cd worker
   npx wrangler deploy --config wrangler.faceit.toml
   ```

   (Or create a Worker in the Cloudflare dashboard and paste in `faceit-proxy.js`.)

3. **Add your key as a secret** — never commit it:

   ```bash
   npx wrangler secret put FACEIT_API_KEY --config wrangler.faceit.toml
   ```

   (Dashboard equivalent: your Worker → Settings → Variables and Secrets → add a
   **secret** named `FACEIT_API_KEY`.)

4. **Point the widget at the Worker** via a repository **variable** (or
   `.env.local` for local dev) named `VITE_FACEIT_PROXY_URL`. The URL is not
   sensitive — it gets inlined into the public bundle — so a plain repository
   *variable* is fine. The **FACEIT key stays on Cloudflare** and never reaches
   the browser.

# Live-status proxies (Cloudflare Workers)

These are **separate Workers, one per platform** (`twitch-live-proxy.js`,
`youtube-live-proxy.js`, `kick-live-proxy.js`), so each platform's credentials
live apart from the Steam key and from each other. They power the widget's
optional **session win/loss**: pasting a Twitch, YouTube, or Kick link in the
customizer switches the W/L pills to a **per-stream record** — they reset to
`W0 L0` when the channel goes live, count only matches finished during that
stream, and freeze (keeping the last stream's record) once the channel goes
offline. The session is stored per player in the browser's `localStorage`, so an
OBS source refresh mid-stream doesn't lose it.

The customizer detects the platform from the link the user pastes and routes to
that platform's Worker. **You only need to deploy the platforms you want** — any
Worker you skip just means links for that platform fall back to the normal
rolling-window W/L. Every check reads only **public** data ("is channel X
live?"); the streamer never logs in or authorizes anything.

## Twitch

Twitch's Helix **Get Streams** needs an *app access token*, which requires a
client id **and secret** (the client-credentials flow), so it has to run on a
Worker.

1. **Register a Twitch application** at
   <https://dev.twitch.tv/console/apps> → **Register Your Application**. Any name
   works; set the OAuth redirect URL to `http://localhost` (unused by the
   client-credentials flow). Note the **Client ID** and generate a **Client
   Secret**.

2. **Deploy** and **add the secrets**:

   ```bash
   cd worker
   npx wrangler deploy --config wrangler.twitch.toml
   npx wrangler secret put TWITCH_CLIENT_ID --config wrangler.twitch.toml
   npx wrangler secret put TWITCH_CLIENT_SECRET --config wrangler.twitch.toml
   ```

3. **Point the widget at it** via a repository **variable** (or `.env.local` for
   local dev) named `VITE_TWITCH_PROXY_URL`.

## YouTube

The YouTube Data API v3 check uses a plain **API key** — no OAuth, no app
verification (it reads only public data). The catch is **quota**: the API gives
10,000 units/day by default and the live check (`search.list`) costs 100 units
each, so the Worker caches results at the edge for ~60s and caches handle→id
resolution in memory. Real API calls happen at most ~once per channel per minute
per Cloudflare colo.

1. **Create an API key**: in the [Google Cloud
   Console](https://console.cloud.google.com/), create a project, enable
   **YouTube Data API v3**, then create an API key under **APIs & Services →
   Credentials**. (Creating the key means agreeing to the [YouTube API Services
   Terms](https://developers.google.com/youtube/terms/api-services-terms-of-service).)

2. **Deploy** and **add the key**:

   ```bash
   cd worker
   npx wrangler deploy --config wrangler.youtube.toml
   npx wrangler secret put YOUTUBE_API_KEY --config wrangler.youtube.toml
   ```

3. **Point the widget at it** via a repository **variable** (or `.env.local`)
   named `VITE_YOUTUBE_PROXY_URL`.

The Worker accepts an `@handle`, a `UC…` channel id, or a legacy custom/user
name and resolves it to a channel id itself.

## Kick

Kick's official API uses the same shape as Twitch: an *app access token* from a
client id **and secret** (OAuth 2.1 client-credentials).

1. **Register an app** in your Kick account under **Settings → Developer** and
   note the **Client ID** + **Client Secret**.

2. **Deploy** and **add the secrets**:

   ```bash
   cd worker
   npx wrangler deploy --config wrangler.kick.toml
   npx wrangler secret put KICK_CLIENT_ID --config wrangler.kick.toml
   npx wrangler secret put KICK_CLIENT_SECRET --config wrangler.kick.toml
   ```

3. **Point the widget at it** via a repository **variable** (or `.env.local`)
   named `VITE_KICK_PROXY_URL`.

## Polling

The widget calls `GET {PROXY}?<platform>=<channel>` every ~15 seconds
(independent of the slower stats refresh). If a platform's credentials aren't set
its Worker returns `501` and the widget falls back to the rolling-window W/L — as
it also does when that Worker isn't deployed at all.

## Allowed origins (CORS)

**Every** Worker gates browser requests by an `ALLOWED_ORIGINS` set at the top of
its file — that's what stops other websites from spending your keys / quota.
Edit that list in each of `leetify-proxy.js`, `steam-avatar-proxy.js`,
`faceit-proxy.js`, `twitch-live-proxy.js`, `youtube-live-proxy.js`, and
`kick-live-proxy.js`
(scheme + host only, no trailing slash) to match wherever the widget is hosted,
e.g.
`https://<you>.github.io`, plus `http://localhost:5173` for local dev. After
changing it, redeploy that Worker.

## Response shape

**Leetify profile / matches** (`leetify-proxy.js`) — a thin pass-through of
Leetify's public API, so the bodies are Leetify's own, forwarded verbatim with
CORS added:

```
GET /?steam64_id=76561198123894701             → 200 <v3/profile payload>
GET /?steam64_id=76561198123894701&matches=1   → 200 <v3/profile/matches payload>
```

An invalid or missing `steam64_id` returns `400`; if Leetify itself is
unreachable the Worker returns `502`. Any other upstream status (e.g. Leetify's
own `404`/`5xx`) is forwarded as-is. Successful responses are cached ~30s;
errors are never cached.

**Avatar lookup:**

```
GET /?steam64_id=76561198123894701
→ 200 { "avatarUrl": "https://avatars.steamstatic.com/<hash>_full.jpg" }
```

A private profile or unknown ID returns `{ "avatarUrl": "" }` (the widget then
just hides the avatar). Invalid IDs return `400`.

**Vanity-URL resolution:**

```
GET /?vanity=gabelogannewell
→ 200 { "steamId": "76561197960287930" }
```

A name with no matching profile returns `404 { "error": … }`; invalid names
return `400`.

**FACEIT profile** (`faceit-proxy.js`) — keyed by Steam64 ID (a CS2 player's
FACEIT `game_player_id` is their Steam ID), so the widget uses the same identity
for Premier and FACEIT:

```
GET /?steam64_id=76561198034202275&history=10
→ 200 {
    "nickname": "s1mple", "playerId": "…", "country": "ua",
    "avatarUrl": "https://…", "elo": 3200, "eloDiff": 140, "level": 10, "region": "EU",
    "winRate": 0.61, "kd": 1.34, "adr": 92.1, "hs": 0.53,
    "position": 528,                       // Challenger rank, else null
    "matches": [
      { "matchId": "…", "outcome": "win", "kills": 24, "deaths": 15, "adr": 98.2, "hs": 0.58, "eloChange": 23 },
      …
    ]
  }
```

`history` is optional (default 10, capped at 20). Lifetime fields the API
doesn't expose come back `null`; a per-match stat that can't be fetched leaves
that match's `kills`/`deaths` `null` but keeps its `outcome`. `eloChange` is the
ELO gained/lost in that match and `eloDiff` their sum across the window (the
widget's TOTAL-mode loss/gain). FACEIT exposes no per-match ELO to servers (the
Data API has none; faceit.com's internal stats API is behind a bot check and
blocks cross-origin reads), so the Worker records it itself: each profile fetch
saves the player's ELO and newest match id in the `ELO_HISTORY` KV namespace,
and when exactly one new match appears its change is the ELO difference. Matches
played before tracking started, or several finished between two fetches, come
back `eloChange: null` (the widget shows W/L for those). A Steam account
with no FACEIT CS2 profile returns `404`, an invalid `steam64_id` `400`, and a
missing `FACEIT_API_KEY` `500`. Successful responses are cached ~30s; errors are
never cached.

**Live status** (each platform's Worker, keyed by its own param):

```
GET /?twitch=ninja                 (twitch-live-proxy.js)
GET /?youtube=@MrBeast             (youtube-live-proxy.js — @handle, UC… id, or name)
GET /?kick=xqc                     (kick-live-proxy.js)
→ 200 { "live": true }   // or { "live": false } when offline
```

Invalid channels return `400`; when a platform's credentials aren't configured
the lookup returns `501 { "error": … }` (the widget then falls back to the normal
rolling-window W/L). The Twitch and Kick responses are never cached, since live
status changes; the YouTube Worker caches at the edge for ~60s to protect its
API quota (see the YouTube section above).

---

> **Analytics reverse proxy?** PostHog's "Reverse proxy" health check is handled
> **without a Worker** — via PostHog's own free **Managed reverse proxy** (just a
> CNAME on a generic subdomain). See
> [`docs/ANALYTICS.md`](../docs/ANALYTICS.md#reverse-proxy-optional).
