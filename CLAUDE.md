# Notes for Claude

- The owner manages Cloudflare through the **dashboard UI**, not the Wrangler
  CLI. When giving setup or ops steps (creating Workers, queues, KV, secrets,
  variables, tokens), write them as dashboard click-paths. Wrangler commands
  can appear only as an optional aside.
- The site deploys through Cloudflare Workers Builds (`wrangler.jsonc`); the
  proxy Workers in `worker/` deploy through the "Deploy proxy Workers" GitHub
  Action on push to `main`.
