# Deployment

How this repo gets from a `git push` to a live site, a per-PR preview, and a
Discord ping. It's written two ways at once:

- **What this repo does**: the actual config, with file references.
- **How to set up another project the same way**: the
  [checklist](#checklist-set-up-a-new-project-this-way) at the end. Hand this
  file to Claude in another repo and say "deploy should work like this".

Cloudflare is managed through the **dashboard**, so steps below are dashboard
click-paths. Anything marked *(inferred)* is configured in the Cloudflare
dashboard and isn't visible from the repo; it was worked out from the repo and
PR history rather than read from settings.

## The picture

```
            push to a branch / open a PR                    merge to main
                       │                                          │
                       ▼                                          ▼
     ┌──────────────── Cloudflare Workers Builds (Worker: kapkit-cs2overlay) ───────────────┐
     │  npm run build  →  wrangler (preview upload)        npm run build → wrangler deploy  │
     └───────┬─────────────────────────────┬──────────────────────────────┬─────────────────┘
             │                             │                              │
             ▼                             ▼                              ▼
  <branch>-kapkit-cs2overlay      PR comment from the            cs2widget.kapkit.ca
  .sid-kapahi.workers.dev         Cloudflare GitHub bot          (production)
  (preview URL)                   with the preview link
             │                                                            │
             └──────────── build event → Queue kapkit-build-events ───────┘
                                          │
                                          ▼
                          build-notify Worker (sidkapahi/preview-bot)
                                          │
                                          ▼
                         Discord: "Preview Ready" / "Live" / "Build Failed"

  Separately, on push to main touching worker/**:
  GitHub Action "Deploy proxy Workers" → wrangler deploy for each changed proxy Worker
```

There are three independent pieces:

1. **The site**: one Cloudflare Worker serving static assets, built and
   deployed by **Workers Builds** (Cloudflare's Git integration). This gives
   production deploys, branch previews and the PR comment.
2. **The proxy Workers** in `worker/`: small API Workers with secrets, deployed
   by a **GitHub Action** on push to `main` only.
3. **The preview bot**: a shared `build-notify` Worker in its own repo
   ([sidkapahi/preview-bot](https://github.com/sidkapahi/preview-bot)) that
   turns Workers Builds events into Discord messages for every kapKit project.

## 1. The site: Workers Builds

### Config in the repo

[`wrangler.jsonc`](../wrangler.jsonc) defines the site as a static-assets-only
Worker. No server code, no `main`:

```jsonc
{
  "name": "kapkit-cs2overlay",          // must match the Worker name in the dashboard
  "compatibility_date": "2026-09-01",
  "assets": { "directory": "./dist" },  // Vite's build output
  "observability": { "logs": { "enabled": true, "invocation_logs": true, "persist": true } },
  "previews": {}                        // required for branch previews (see below)
}
```

- **Build command**: `npm run build` (`tsc && vite build`, from
  [`package.json`](../package.json)), writing to `dist/`.
- **Deploy command**: `npx wrangler deploy`, run from the repo root, which
  reads `wrangler.jsonc`.
- **`"previews": {}`**: Workers Builds runs a preview upload for every
  non-production branch, and that needs a `previews` block to exist. It's empty
  because the site has no runtime vars or bindings; everything is baked in at
  build time.
- **Observability** keeps request and console logs under the Worker's
  **Observability** tab.

### Connection in the dashboard

The Worker `kapkit-cs2overlay` is connected to `sidkapahi/kapkit-cs2overlay`
under **Workers & Pages → kapkit-cs2overlay → Settings → Build**:

| Setting | Value |
|---|---|
| Git repository | `sidkapahi/kapkit-cs2overlay` |
| Production branch | `main` |
| Builds for non-production branches | On *(inferred: every PR gets a preview)* |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch deploy command | Cloudflare's default preview upload *(inferred)* |
| Root directory | `/` |
| Build variables | the `VITE_*` values, see [Build variables](#build-variables) |

Connecting the repo installs the **Cloudflare Workers and Pages** GitHub App on
it. That app is what posts the PR comment.

The custom domain `cs2widget.kapkit.ca` is attached in the dashboard
(**Settings → Domains & Routes**), not in `wrangler.jsonc` *(inferred: there's
no `routes` entry in the file)*. Because Workers Builds deploys with
`wrangler deploy`, a domain added only in the dashboard survives deploys. If
you want it in code instead, preview-bot shows the pattern:
`"routes": [{ "pattern": "your.domain", "custom_domain": true }]`.

### What happens on each push

| Push to | Result |
|---|---|
| `main` (usually a PR merge) | Build → `wrangler deploy` → live at `https://cs2widget.kapkit.ca` (and `kapkit-cs2overlay.sid-kapahi.workers.dev`). |
| Any other branch | Build → preview upload. Live at a **branch preview URL** that stays the same for the branch, plus a per-version URL for that exact commit. |

Preview URL formats (from the bot comment on PR #109):

- **Branch URL** (latest commit on the branch):
  `https://<branch-slug>-kapkit-cs2overlay.sid-kapahi.workers.dev`, where the
  slug is the branch lowercased with anything outside `a-z0-9` turned into `-`
  (`claude/project-thread-n608hh` → `claude-project-thread-n608hh`), capped so
  the hostname label stays under 63 characters.
- **Version URL** (one specific commit):
  `https://<8-char version id>-kapkit-cs2overlay.sid-kapahi.workers.dev`.

### The PR comment (Cloudflare GitHub bot)

On every PR, `cloudflare-workers-and-pages[bot]` posts one comment titled
**"Deploying Preview to Cloudflare"** and edits it on each new commit:

- **Preview URL**: the branch URL, with the commit it currently reflects.
- **Preview Deployments by commit**: a table row per commit with build and
  deployment status, the version URL, the time, and links to the build logs
  and the dashboard.

Nothing in the repo configures this. It comes for free from connecting the
repo to Workers Builds (the GitHub App) with non-production builds turned on.
It also adds a check run named **Workers Builds: kapkit-cs2overlay** to each
commit, so a failed preview build shows red on the PR.

### Build variables

All site config is **build-time**: Vite inlines `VITE_*` variables into the
public bundle. They're set on the Worker under **Workers & Pages →
kapkit-cs2overlay → Settings → Build → Variables and secrets** and apply to
production and preview builds alike.

| Variable | What |
|---|---|
| `VITE_LEETIFY_PROXY_URL` | Leetify proxy Worker URL |
| `VITE_AVATAR_PROXY_URL` | Steam avatar proxy Worker URL |
| `VITE_FACEIT_PROXY_URL` | FACEIT proxy Worker URL |
| `VITE_TWITCH_PROXY_URL`, `VITE_YOUTUBE_PROXY_URL`, `VITE_KICK_PROXY_URL` | Live-status proxy Worker URLs |
| `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` | PostHog project key and host |
| `VITE_LEETIFY_KEY` | Optional, only used if there's no Leetify proxy |

These end up in the browser, so they must never be real secrets. API keys live
on the proxy Workers instead. (`.env.example` and `worker/README.md` still say
"GitHub Actions repository variable" for some of these. That's from when the
site was on GitHub Pages; Workers Builds reads its own variables.)

Workers Builds also sets `WORKERS_CI_COMMIT_SHA`, which the build uses for the
build id below.

### Build id and auto-reload

OBS keeps a browser source open for days, so open overlays reload themselves
when a new build ships ([`vite.config.ts`](../vite.config.ts),
[`src/widget/autoReload.ts`](../src/widget/autoReload.ts)):

1. At build time, `buildId = <first 7 of WORKERS_CI_COMMIT_SHA>-<timestamp>`.
   The timestamp makes a rebuild of the same commit count as new.
2. The id is baked into the bundle as `__BUILD_ID__` and written to
   `/version.json` (`{"build": "<id>"}`) by a small Vite plugin.
3. The overlay fetches `/version.json` (no-cache) every minute and when it
   becomes visible. If the id differs, it `location.reload()`s at a quiet
   moment, with a sessionStorage guard against reload loops on a stale cache.

This works the same on preview URLs, since each preview is its own build.

## 2. Proxy Workers: GitHub Action

The API proxies in [`worker/`](../worker) (Leetify, Steam avatar, FACEIT,
Twitch, YouTube, Kick) are **separate Workers**, each with its own
`worker/wrangler.<name>.toml`. They are **not** deployed by Workers Builds.

[`.github/workflows/deploy-workers.yml`](../.github/workflows/deploy-workers.yml)
("Deploy proxy Workers"):

- Runs on **push to `main` touching `worker/**`**, or by hand (**Actions →
  Deploy proxy Workers → Run workflow**, which deploys all of them).
- For each `worker/wrangler*.toml`, deploys it with `npx wrangler@4 deploy
  --config <file>` only if that config or its `main` script changed in the
  push.
- Leaves the Workers' secrets alone (`wrangler deploy` doesn't touch secrets).

GitHub repo secrets it needs (**Settings → Secrets and variables → Actions**):

| Secret | What |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API token with **Account · Workers Scripts · Edit** (plus **Workers KV Storage · Edit** if a Worker binds KV, **Queues · Edit** if it uses queues) |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account id |

Worker secrets (set per Worker in **Workers & Pages → <worker> → Settings →
Variables and Secrets → Add → Type: Secret**, never committed):

| Worker | Secrets |
|---|---|
| `leetify-proxy` | `LEETIFY_KEY` (optional) |
| `cs2-steam-avatar-proxy` | `STEAM_API_KEY` |
| `faceit-proxy` | `FACEIT_API_KEY` (and the `ELO_HISTORY` KV binding in its toml) |
| `twitch-live-proxy` | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` |
| `youtube-live-proxy` | `YOUTUBE_API_KEY` |
| `kick-live-proxy` | `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET` |

Use **Secret**, not a plain variable: a plain variable set in the dashboard is
wiped by the next `wrangler deploy`.

### Previews can't test proxy changes

Proxy Workers only deploy from `main`, and there's one copy of each. A PR's
preview site still calls the **production** proxies, so a PR that changes
`worker/` can't be checked on its preview; it takes effect after merge.

For the preview site to be allowed to call the proxies at all, every proxy's
CORS check accepts the preview hostnames as well as production:

```js
const ALLOWED_ORIGINS = new Set([
  'https://cs2widget.kapkit.ca',
  'https://kapkit-cs2overlay.sid-kapahi.workers.dev',
  'http://localhost:5173',
  // …
]);
const PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+-kapkit-cs2overlay\.sid-kapahi\.workers\.dev$/;
```

Only Workers on this account can live under `sid-kapahi.workers.dev`, so the
regex doesn't open it to other sites.

## 3. The preview bot (Discord)

The Discord "Preview Ready / Live / Build Failed" messages come from the
`build-notify` Worker in
[sidkapahi/preview-bot](https://github.com/sidkapahi/preview-bot), shared by
every kapKit project. Its README has the full setup; here's how it connects:

1. Workers Builds publishes build events (started / succeeded / failed /
   cancelled) through an **Event Subscription** to the Queue
   **`kapkit-build-events`**.
2. `build-notify` is the queue's consumer. It ignores started and cancelled,
   and for succeeded / failed builds posts a Discord embed:
   - **Preview Ready** (green, @mention) for non-production branches, with a
     button to the branch preview URL (built from the branch name the same way
     Cloudflare does).
   - **Live** (blue, no mention) for the production branch, linking the
     production URL.
   - **Build Failed** (red, @mention) with a link to the build logs.
3. Per-project settings (name, icon, image, production URL, Discord channel,
   buttons) are in preview-bot's `src/projects.js` and can be overridden in the
   embed editor at <https://previewbot.kaplabs.ca>. This repo's entry is
   `kapkit-cs2overlay`, posting through the `DISCORD_WEBHOOK_CS2` secret, with
   a **▶️ Customizer** button and a **🎮 OBS overlay** button (`/widget/`).

Nothing in this repo is involved. Hooking a project up is entirely dashboard
side: subscribe the queue to that project's Worker builds.

## Commit messages

The preview bot builds each Discord message from the built commit's message:
the **first line is the embed title** and **the rest is the description**
(trailing `Key: value` trailers such as `Co-Authored-By:` are dropped, and the
description is cut at 1000 characters). So every commit follows this format:

```
Short title of the change

One sentence on what this does, for someone skimming Discord.

- Detail of what changed
- Another detail
- Files, settings or behaviour worth calling out

Co-Authored-By: …
```

- **Line 1, title**: imperative, under ~70 characters, no trailing period.
- **Quick description**: one sentence, after a blank line.
- **Details**: after another blank line; bullets or short paragraphs.
- **Don't hard-wrap.** Write each sentence or bullet on one line. Discord
  keeps every line break, so text wrapped at 72 columns shows up broken
  mid-sentence.
- Keep the blank lines. Git treats everything up to the first blank line as
  the subject, so dropping them glues the description into the title in
  `git log`.

On `main`, PRs are squash-merged, so the deployed commit's title is the **PR
title** (with ` (#123)` appended) and its body is built from the PR's
commits. A single-commit PR keeps its message as is; for several commits,
edit the squash message in GitHub's merge box into the same format.

## Known gotchas

- **"Build failed to initialize and was timed out"** on a preview build is a
  Cloudflare infrastructure hiccup, not a code problem. Fix: open the build in
  **Workers & Pages → kapkit-cs2overlay → Deployments** (or the "View logs"
  link in the PR comment) → **Retry build**.
- **Proxy changes don't show on previews.** See
  [above](#previews-cant-test-proxy-changes).
- **Plain dashboard variables get wiped** by the next deploy. Use **Secret**
  for Worker secrets, and **Build → Variables** (not runtime variables) for
  `VITE_*`.
- **Branch names become hostnames.** Long branch names are truncated in the
  preview URL, and two branches that slug the same way share a preview URL.
- **Keep the Worker name stable.** The `name` in `wrangler.jsonc` must match
  the dashboard Worker. Renaming creates a new Worker without the domain,
  build variables, or queue subscription.

## Checklist: set up a new project this way

For a static (or mostly static) site plus optional API Workers.

**In the repo**

1. `wrangler.jsonc` at the root: `name` = the Worker name, a
   `compatibility_date`, `assets.directory` = the build output folder, the
   `observability.logs` block, and `"previews": {}`. Add `main` only if the
   site has server code.
2. A `build` script in `package.json` that writes to that folder.
3. *(Optional)* Build id + auto-reload: copy the `versionFile()` plugin and
   `__BUILD_ID__` define from `vite.config.ts`, reading
   `WORKERS_CI_COMMIT_SHA`, and poll `/version.json` from the page.
4. *(If there are API Workers)* Put each in `worker/` with its own
   `wrangler.<name>.toml`, copy `.github/workflows/deploy-workers.yml`, and
   give each Worker a CORS allow-list that includes production, localhost and
   the regex `^https://[a-z0-9-]+-<site-worker>\.sid-kapahi\.workers\.dev$`
   for previews.
5. A `CLAUDE.md` noting that Cloudflare is managed through the dashboard,
   how each part deploys, and the [commit message format](#commit-messages).

**In Cloudflare (dashboard)**

6. **Workers & Pages → Create → Import a repository** → pick the repo. Worker
   name = `name` from `wrangler.jsonc`. Build command `npm run build`, deploy
   command `npx wrangler deploy`, production branch `main`.
7. **Settings → Build → Branch control**: turn on builds for non-production
   branches (this is what gives preview URLs and the PR comment).
8. **Settings → Build → Variables and secrets**: add the `VITE_*` (or other
   build-time) values.
9. **Settings → Domains & Routes → Add → Custom domain** for production.
10. *(If there are API Workers)* Create an API token (**profile → API Tokens →
    Create token**, Workers Scripts Edit, plus KV / Queues Edit if used) and
    add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub repo
    secrets. After the first deploy, add each Worker's secrets as **Secret**
    type.

**Discord notifications**

11. **Compute (Workers) → Queues → `kapkit-build-events` → Subscriptions →
    Subscribe to events** → Source **Workers Builds**, the new Worker, tick
    **Build succeeded** and **Build failed**.
12. Create a webhook in the project's Discord channel, add it as a secret on
    **build-notify** (e.g. `DISCORD_WEBHOOK_MYAPP`), and add the project in the
    embed editor or `src/projects.js` in preview-bot.

**Check it**

13. Open a PR: the Cloudflare bot comments a preview URL, the preview loads,
    and Discord posts **Preview Ready**. Merge: production updates and Discord
    posts **Live**.
