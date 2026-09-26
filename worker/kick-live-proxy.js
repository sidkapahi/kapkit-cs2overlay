// Cloudflare Worker: Kick live-status proxy
//
// The widget is a static GitHub Pages site, so it can't check Kick live status
// itself: Kick's official API needs an *app access token*, and minting one
// requires a client id AND secret (the OAuth 2.1 client-credentials flow) that
// must stay server-side. This Worker keeps those secrets on Cloudflare and
// answers a single lookup, adding the CORS headers the browser needs:
//   • GET ?kick=<channel-slug>  → { live: bool }   (is that channel live now)
//
// It's deliberately separate from the other proxies so each platform's
// credentials live on their own Worker.
//
// Setup (see worker/README.md for details):
//   1. Register an app in your Kick account (Settings → Developer) and copy its
//      Client ID + generate a Client Secret.
//   2. Deploy this Worker:
//        wrangler deploy --config wrangler.kick.toml
//   3. Add the credentials as secrets:
//        wrangler secret put KICK_CLIENT_ID --config wrangler.kick.toml
//        wrangler secret put KICK_CLIENT_SECRET --config wrangler.kick.toml
//   4. Point the widget at this Worker's URL via VITE_KICK_PROXY_URL
//      (see the repo README).

// Only these site origins may call the Worker from a browser. CORS is what stops
// other websites from spending your Kick app's rate limit. Add or remove entries
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
    const kick = url.searchParams.get('kick');
    if (kick !== null) return resolveKickLive(kick, env, cors);

    return json({ error: 'Missing kick query parameter' }, 400, cors);
  },
};

// Is `slug` currently streaming? Kick's public channels endpoint returns the
// channel with its livestream state; we read the live flag off it.
async function resolveKickLive(slug, env, cors) {
  const name = slug.trim().toLowerCase();
  // Kick slugs are letters/digits/underscores/hyphens. Reject anything else so
  // the Worker can't be used to smuggle arbitrary query params.
  if (!/^[a-z0-9_-]{1,25}$/.test(name)) {
    return json({ error: 'Invalid Kick slug' }, 400, cors);
  }

  if (!env.KICK_CLIENT_ID || !env.KICK_CLIENT_SECRET) {
    // Not configured — tell the widget so it falls back to rolling-window W/L.
    return json({ error: 'Worker is missing the Kick credentials' }, 501, cors);
  }

  let token;
  try {
    token = await getKickToken(env);
  } catch {
    return json({ error: 'Failed to get a Kick token' }, 502, cors);
  }

  try {
    const res = await fetch(
      `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(name)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    );
    // A 401 usually means the cached token was revoked; drop it so the next
    // request mints a fresh one.
    if (res.status === 401) KICK_TOKEN = null;
    if (!res.ok) return json({ error: `Kick API error: ${res.status}` }, 502, cors);
    const data = await res.json();
    const channel = Array.isArray(data?.data) ? data.data[0] : data?.data ?? data;
    return json({ live: extractLive(channel) }, 200, cors);
  } catch {
    return json({ error: 'Failed to reach the Kick API' }, 502, cors);
  }
}

// Pulls a boolean live flag out of a Kick channel object, tolerating the couple
// of shapes the API has used: a `stream.is_live` flag, a top-level `is_live`, or
// a truthy `livestream` object (null when offline).
function extractLive(channel) {
  if (!channel || typeof channel !== 'object') return false;
  if (typeof channel.stream?.is_live === 'boolean') return channel.stream.is_live;
  if (typeof channel.is_live === 'boolean') return channel.is_live;
  return !!channel.livestream;
}

// App access token cache, shared across requests in a warm isolate. Refreshed
// when missing or within 60s of expiry.
let KICK_TOKEN = null; // { value: string, expiresAt: number(ms) }

async function getKickToken(env) {
  const now = Date.now();
  if (KICK_TOKEN && KICK_TOKEN.expiresAt - 60_000 > now) {
    return KICK_TOKEN.value;
  }
  const params = new URLSearchParams({
    client_id: env.KICK_CLIENT_ID,
    client_secret: env.KICK_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });
  const res = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const data = await res.json();
  if (!data?.access_token) throw new Error('no access_token');
  KICK_TOKEN = {
    value: data.access_token,
    // expires_in is seconds; default to 1h if it's somehow missing.
    expiresAt: now + (Number(data.expires_in) || 3600) * 1000,
  };
  return KICK_TOKEN.value;
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Live status is time-sensitive and the widget polls often, so never
      // cache it — a cached "live" would linger after the stream ended.
      'Cache-Control': 'no-store',
      ...cors,
    },
  });
}
