# Development & self-hosting

Everything you need to run CS2 Stats Overlay locally, self-host it, or
contribute. For a plain user guide (build a widget URL, add it to OBS), see the
[README](../README.md).

## Run locally

```bash
npm install
cp .env.example .env.local   # optional: paste your Leetify Public API key
npm run dev
```

- Customizer: `http://localhost:5173/`
- Widget: `http://localhost:5173/widget/`

`VITE_LEETIFY_KEY` is optional — without it, requests still work but hit
Leetify's stricter unauthenticated rate limits. For the deployed site, set
`VITE_*` values as **build variables** on the `kapkit-cs2overlay` Worker in
Cloudflare (Settings → Build → Variables), so they're injected into the build.

## Build

```bash
npm run build     # tsc + vite build → static output
npm run preview   # preview the production build
```

The output is a plain static site (the customizer and the widget), deployable to
any static host. The project deploys to Cloudflare Workers (static assets, see
`wrangler.jsonc`) via Workers Builds: pushes to `main` go to production at
`cs2widget.kapkit.ca`, and every other branch gets its own preview URL.

## Optional: avatars & custom profile links (Cloudflare Worker)

Leetify's public API doesn't return a player avatar, and a static site can't call
Steam's Web API directly (it needs a secret key and sends no CORS headers). The
small Cloudflare Worker in [`worker/`](../worker) covers both: it fetches avatars
**and** resolves custom `steamcommunity.com/id/…` profile links to a Steam64 ID.
Deploy it and set `VITE_AVATAR_PROXY_URL` to its URL — full steps in
[worker/README.md](../worker/README.md). Your Steam API key stays on the Worker
and never reaches the browser. Skip this and the widget still runs — just without
avatars, and custom-URL links must be entered as a Steam64 ID or a `/profiles/…`
link instead.

## Optional: FACEIT mode (Cloudflare Worker)

The customizer's **FACEIT** provider (the `PREMIER | FACEIT` toggle) reads FACEIT
data instead of Leetify/Premier — ELO, skill level, lifetime stats (K/D, win
rate, ADR, HS%), recent match history, and the Challenger leaderboard position.
FACEIT's Data API needs a secret key and sends no CORS headers, so it runs behind
the Cloudflare Worker in [`worker/faceit-proxy.js`](../worker/faceit-proxy.js).
Deploy it and set `VITE_FACEIT_PROXY_URL` to its URL — full steps (create a
server-side FACEIT key, deploy, add the secret) are in
[worker/README.md](../worker/README.md#faceit-proxy-cloudflare-worker). Skip this
and Premier mode works as before; FACEIT mode just has no data source.

## Optional: live-status proxies (Twitch / YouTube / Kick)

The live-session W/L feature uses a **separate Cloudflare Worker per platform**
(`worker/twitch-live-proxy.js`, `youtube-live-proxy.js`, `kick-live-proxy.js`, so
each platform's credentials live apart). The customizer detects the platform from
the link the user pastes and routes to that Worker; **deploy only the platforms
you want**. Point the site at each with `VITE_TWITCH_PROXY_URL`,
`VITE_YOUTUBE_PROXY_URL`, and `VITE_KICK_PROXY_URL`. Full per-platform steps
(Twitch app, YouTube API key + quota note, Kick app) are in
[worker/README.md](../worker/README.md#live-status-proxies-cloudflare-workers).
Without any of them, the pills keep their normal rolling-window behaviour.

## Optional: analytics (PostHog)

Analytics runs on [PostHog](https://posthog.com) — how people find the site
(referrers/UTM), which settings combinations they build, adoption, retention, and
errors. To collect this for your own site:

1. Create a free project at [posthog.com](https://posthog.com).
2. Copy the **Project API Key** (starts with `phc_`) into `VITE_POSTHOG_KEY`, and
   set `VITE_POSTHOG_HOST` to your region (`https://us.i.posthog.com` or
   `https://eu.i.posthog.com`) — in `.env.local` for local dev, and as GitHub
   Actions **repository variables** for the deployed site.

Nothing loads without a key. The **customizer** uses cookie-based analytics but
starts **opted out** — nothing is captured until the visitor accepts the cookie
banner (reviewable via the footer's *Privacy & Cookies* modal). The **overlay**
runs PostHog **cookieless** (no cookies, no storage, no consent banner on stream).

> **The full event reference** — every event, its properties, the reason codes,
> and the automatic PostHog events (`$pageview`, `$web_vitals`, …) — lives in
> [ANALYTICS.md](./ANALYTICS.md).

## Environment variables

| Variable                  | Required | Purpose                                                   |
| ------------------------- | -------- | --------------------------------------------------------- |
| `VITE_LEETIFY_KEY`        | No       | Leetify Public API key — raises rate limits (secret)      |
| `VITE_AVATAR_PROXY_URL`   | No       | Steam avatar / custom-link proxy Worker URL (public)      |
| `VITE_FACEIT_PROXY_URL`   | No\*     | FACEIT proxy Worker URL (public) — \*required for FACEIT mode |
| `VITE_TWITCH_PROXY_URL`   | No       | Twitch live-status proxy Worker URL (public)              |
| `VITE_YOUTUBE_PROXY_URL`  | No       | YouTube live-status proxy Worker URL (public)             |
| `VITE_KICK_PROXY_URL`     | No       | Kick live-status proxy Worker URL (public)                |
| `VITE_POSTHOG_KEY`        | No       | PostHog project API key for analytics (public)            |
| `VITE_POSTHOG_HOST`       | No       | PostHog API host / region (default US)                    |

See [`.env.example`](../.env.example) for details on each.

## Project layout

```
src/customizer/   Customizer UI (build & preview widget URLs)
src/widget/       The overlay itself (rendered in OBS / browser source)
src/shared/       API client, rank logic, rendering, session, export helpers
worker/           Optional Cloudflare Workers (avatar + Twitch/YouTube/Kick live proxies)
public/           Static assets (fonts, images)
docs/             This guide + the analytics event reference
```

## Tech Stack

| Tool | Purpose |
| ---- | ------- |
| [TypeScript](https://www.typescriptlang.org) | Application logic |
| [Vite](https://vitejs.dev) | Multi-page build & dev server |
| [Leetify API](https://leetify.com) | Live CS2 stats & match data |
| [Cloudflare Workers](https://workers.cloudflare.com) | Optional avatar + Twitch/YouTube/Kick live-status proxies |
| [PostHog](https://posthog.com) | Optional product analytics (consent-gated) |

## Contributing

Issues and PRs are welcome — bug fixes, new display options, and code review of
the AI-assisted parts especially. Open an
[issue](https://github.com/sidkapahi/cs2-stats-overlay/issues) or send a PR.
