// Cloudflare Worker: Twitch live-status proxy
//
// The widget is a static GitHub Pages site, so it can't check Twitch live status
// itself: Twitch's Helix `Get Streams` needs an *app access token*, and minting
// one requires a client id AND secret (the client-credentials flow) that must
// stay server-side. This Worker keeps those secrets on Cloudflare and answers a
// single lookup, adding the CORS headers the browser needs:
//   • GET ?twitch=<channel-login>  → { live: bool }   (is that channel live now)
//
// It's deliberately separate from the Steam avatar proxy so the two sets of
// credentials live on different Workers.
//
// Setup (see worker/README.md for details):
//   1. Register an app at https://dev.twitch.tv/console/apps and copy its
//      Client ID + generate a Client Secret.
//   2. Deploy this Worker:
//        wrangler deploy --config wrangler.twitch.toml
//      (or create a Worker in the dashboard and paste in this file).
//   3. Add the credentials as secrets:
//        wrangler secret put TWITCH_CLIENT_ID --config wrangler.twitch.toml
//        wrangler secret put TWITCH_CLIENT_SECRET --config wrangler.twitch.toml
//   4. Point the widget at this Worker's URL via VITE_TWITCH_PROXY_URL
//      (see the repo README).

// Only these site origins may call the Worker from a browser. CORS is what stops
// other websites from spending your Twitch app's rate limit. Add or remove
// entries here (scheme + host only, no trailing slash or path).
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
    const twitch = url.searchParams.get('twitch');
    if (twitch !== null) return resolveTwitchLive(twitch, env, cors);

    return json({ error: 'Missing twitch query parameter' }, 400, cors);
  },
};

// Is `login` currently streaming? Twitch's Helix Get Streams only returns an
// entry for channels that are live, so an offline channel yields an empty list.
async function resolveTwitchLive(login, env, cors) {
  const name = login.trim().toLowerCase();
  // Twitch logins are letters/digits/underscores (up to 25). Reject anything
  // else so the Worker can't be used to smuggle arbitrary query params.
  if (!/^[a-z0-9_]{1,25}$/.test(name)) {
    return json({ error: 'Invalid Twitch login' }, 400, cors);
  }

  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    // Not configured — tell the widget so it falls back to rolling-window W/L.
    return json({ error: 'Worker is missing the Twitch credentials' }, 501, cors);
  }

  let token;
  try {
    token = await getTwitchToken(env);
  } catch {
    return json({ error: 'Failed to get a Twitch token' }, 502, cors);
  }

  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(name)}`,
      { headers: { 'Client-Id': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } },
    );
    // A 401 usually means the cached token was revoked; drop it so the next
    // request mints a fresh one.
    if (res.status === 401) TWITCH_TOKEN = null;
    if (!res.ok) return json({ error: `Twitch API error: ${res.status}` }, 502, cors);
    const data = await res.json();
    const stream = Array.isArray(data?.data) ? data.data[0] : null;
    const live = !!stream && stream.type === 'live';
    return json({ live }, 200, cors);
  } catch {
    return json({ error: 'Failed to reach the Twitch API' }, 502, cors);
  }
}

// App access token cache, shared across requests in a warm isolate. Refreshed
// when missing or within 60s of expiry.
let TWITCH_TOKEN = null; // { value: string, expiresAt: number(ms) }

async function getTwitchToken(env) {
  const now = Date.now();
  if (TWITCH_TOKEN && TWITCH_TOKEN.expiresAt - 60_000 > now) {
    return TWITCH_TOKEN.value;
  }
  const params = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });
  const res = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: 'POST' });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const data = await res.json();
  if (!data?.access_token) throw new Error('no access_token');
  TWITCH_TOKEN = {
    value: data.access_token,
    // expires_in is seconds; default to 1h if it's somehow missing.
    expiresAt: now + (Number(data.expires_in) || 3600) * 1000,
  };
  return TWITCH_TOKEN.value;
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
