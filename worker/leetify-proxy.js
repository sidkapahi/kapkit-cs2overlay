// Cloudflare Worker: Leetify proxy (profile + recent-match stats)
//
// Leetify's public API (api-public.cs-prod.leetify.com) sends NO CORS headers,
// so the widget — a static GitHub Pages site — can't read its responses from a
// browser: the fetch is blocked before any HTTP status is seen and surfaces as
// "Failed to fetch" (in OBS's Chromium browser source too). It's the single most
// common overlay failure. This Worker sits in front of the two endpoints the
// Premier path needs, adds CORS so the browser can read them, and keeps the
// (optional) Leetify API key server-side — out of the public bundle:
//   • GET ?steam64_id=<17-digit id>            → v3/profile         (identity, ranks, recent_matches)
//   • GET ?steam64_id=<17-digit id>&matches=1  → v3/profile/matches (per-match kills/deaths)
//
// Keyed by Steam64 ID, the same identity the whole widget uses. It's a thin
// pass-through: the upstream JSON is forwarded verbatim with our own CORS and a
// short success cache, so the client (src/shared/api.ts) does all the parsing.
//
// Setup (see worker/README.md for details):
//   1. (Optional) get a Leetify API key from https://leetify.com to raise rate limits.
//   2. Deploy this Worker:
//        wrangler deploy --config wrangler.leetify.toml
//      (or create a Worker in the dashboard and paste in this file).
//   3. (Optional) add the key as a secret:
//        wrangler secret put LEETIFY_KEY --config wrangler.leetify.toml
//   4. Point the widget at this Worker's URL via VITE_LEETIFY_PROXY_URL
//      (see the repo README).

// Only these site origins may call the Worker from a browser. CORS is what stops
// other websites from spending your Leetify rate limit. Add or remove entries
// here (scheme + host only, no trailing slash or path).
const ALLOWED_ORIGINS = new Set([
  'https://levanisart.github.io',
  'https://sidkapahi.github.io',
  'https://cs2widget.kapkit.ca',
  'https://kapkit-cs2overlay.sid-kapahi.workers.dev', // Cloudflare production URL
  'http://localhost:5173', // local dev (npm run dev)
]);

// Cloudflare preview deployments of the site: every branch and every upload
// gets its own <prefix>-kapkit-cs2overlay.sid-kapahi.workers.dev host. Only
// Workers on this account can live under that subdomain.
const PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+-kapkit-cs2overlay\.sid-kapahi\.workers\.dev$/;

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.has(origin) || PREVIEW_ORIGIN.test(origin);
}

const LEETIFY_BASE = 'https://api-public.cs-prod.leetify.com/v3/profile';

// Builds the CORS headers for a request. When the caller's Origin is on the
// allowlist we echo it back (the CORS spec allows only one origin per response,
// so it can't be a static list); otherwise no Allow-Origin is sent and the
// browser blocks the response. `Vary: Origin` keeps caches from mixing origins.
function corsHeaders(request) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  };
  const origin = request.headers.get('Origin');
  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);
    const steam64 = (url.searchParams.get('steam64_id') || '').trim();
    // Steam64 IDs are 17-digit numbers; reject anything else so the Worker can't
    // be used as an open proxy for arbitrary Leetify API calls.
    if (!/^\d{17}$/.test(steam64)) {
      return json({ error: 'Invalid or missing steam64_id' }, 400, cors);
    }

    // `matches=1` selects the match-list endpoint (per-match kills/deaths); its
    // absence means the profile payload. Any value counts — the client only ever
    // sends `matches=1`.
    const wantMatches = url.searchParams.get('matches') !== null;
    const target = `${LEETIFY_BASE}${wantMatches ? '/matches' : ''}?steam64_id=${steam64}`;

    // The API key (if configured) is sent server-side and never reaches the
    // browser. Leetify's public API works without it — the key only raises rate
    // limits — so an unset secret is fine.
    const headers = {};
    if (env.LEETIFY_KEY) headers._leetify_key = env.LEETIFY_KEY;

    let upstream;
    try {
      upstream = await fetch(target, { headers });
    } catch {
      return json({ error: 'Failed to reach the Leetify API' }, 502, cors);
    }

    // Thin pass-through: forward the upstream body and status with our own CORS.
    // Read it as text so a non-JSON upstream error still forwards cleanly, and
    // cache successes briefly (the widget polls on its own refresh interval)
    // while never caching errors — a cached 4xx/5xx would stick in the browser
    // and keep masking an already-recovered API.
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': upstream.ok ? 'public, max-age=30' : 'no-store',
        ...cors,
      },
    });
  },
};

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...cors,
    },
  });
}
