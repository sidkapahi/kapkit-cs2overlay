# Notes for Claude

- The owner manages Cloudflare through the **dashboard UI**, not the Wrangler
  CLI. When giving setup or ops steps (creating Workers, queues, KV, secrets,
  variables, tokens), write them as dashboard click-paths. Wrangler commands
  can appear only as an optional aside.
- The site deploys through Cloudflare Workers Builds (`wrangler.jsonc`); the
  proxy Workers in `worker/` deploy through the "Deploy proxy Workers" GitHub
  Action on push to `main`.
- Commit messages feed the Discord preview bot (line 1 becomes the embed
  title, everything after it the description), so write them as: line 1 a
  short title, then a blank line and a one-sentence quick description, then a
  blank line and the details of what changed (bullets are fine). Don't
  hard-wrap lines: Discord shows every line break. Trailers like
  `Co-Authored-By:` go last and are hidden by the bot. See
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#commit-messages).
