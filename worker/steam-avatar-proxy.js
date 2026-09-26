// Cloudflare Worker: Steam proxy (avatars + vanity-URL resolution)
//
// The widget is a static GitHub Pages site, so it can't call Steam's Web API
// directly: the API needs a key (which must stay secret) and sends no CORS
// headers (so browsers block the request). This Worker sits in between,
// keeping the key server-side and adding the CORS headers the browser needs.
// It answers two lookups, both using the Steam Web API:
//   • GET ?steam64_id=<17-digit id>  → { avatarUrl }   (avatar for that id)
//   • GET ?vanity=<custom-url-name>  → { steamId }      (resolve a vanity URL,
//        i.e. the `gabelogannewell` in steamcommunity.com/id/gabelogannewell)
//
// (Twitch live status lives in a separate Worker — see twitch-live-proxy.js.)
//
// Setup (see worker/README.md for details):
//   1. Deploy this Worker (`wrangler deploy`, or paste it in the CF dashboard).
//   2. Add your Steam Web API key as a secret named STEAM_API_KEY:
//        wrangler secret put STEAM_API_KEY
//      (or dashboard → Settings → Variables and Secrets → Add). Get a key at
//      https://steamcommunity.com/dev/apikey
//   3. Point the widget at the Worker's URL via VITE_AVATAR_PROXY_URL
//      (see the repo README).

// Only these site origins may call the Worker from a browser. CORS is what
// stops other websites from using your Steam key / Cloudflare quota. Add or
// remove entries here (scheme + host only, no trailing slash or path).
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

    // Vanity-URL resolution: steamcommunity.com/id/<name> → Steam64 ID.
    const vanity = url.searchParams.get('vanity');
    if (vanity !== null) return resolveVanity(vanity, env, cors);

    const steamId = url.searchParams.get('steam64_id');

    // Steam64 IDs are 17-digit numbers; reject anything else to avoid the
    // Worker being used as an open proxy for arbitrary Steam API calls.
    if (!steamId || !/^\d{17}$/.test(steamId)) {
      return json({ error: 'Invalid or missing steam64_id' }, 400, cors);
    }

    if (!env.STEAM_API_KEY) {
      return json({ error: 'Worker is missing the STEAM_API_KEY secret' }, 500, cors);
    }

    const api =
      'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/' +
      `?key=${env.STEAM_API_KEY}&steamids=${steamId}`;

    let player;
    try {
      const res = await fetch(api);
      if (!res.ok) return json({ error: `Steam API error: ${res.status}` }, 502, cors);
      const data = await res.json();
      player = data?.response?.players?.[0];
    } catch {
      return json({ error: 'Failed to reach the Steam API' }, 502, cors);
    }

    // Private profile or unknown ID: no player returned. Reply 200 with an
    // empty avatar so the widget just hides the avatar slot rather than erroring.
    if (!player) return json({ avatarUrl: '' }, 200, cors);

    // avatarfull is the 184x184 image; avatarmedium (64x64) is also available.
    return json({ avatarUrl: player.avatarfull ?? '' }, 200, cors);
  },
};

// Resolves a Steam custom (vanity) URL name to a Steam64 ID using Steam's
// ResolveVanityURL API. Like the avatar lookup, this needs the secret API key,
// so it has to run here rather than in the browser.
async function resolveVanity(vanity, env, cors) {
  // Vanity names are letters/digits/dashes/underscores/dots. Reject anything
  // else so the Worker can't be used to smuggle arbitrary query params.
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(vanity)) {
    return json({ error: 'Invalid vanity name' }, 400, cors);
  }

  if (!env.STEAM_API_KEY) {
    return json({ error: 'Worker is missing the STEAM_API_KEY secret' }, 500, cors);
  }

  const api =
    'https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/' +
    `?key=${env.STEAM_API_KEY}&vanityurl=${encodeURIComponent(vanity)}`;

  try {
    const res = await fetch(api);
    if (!res.ok) return json({ error: `Steam API error: ${res.status}` }, 502, cors);
    const data = await res.json();
    // success === 1 means resolved; 42 (or anything else) means no such name.
    if (data?.response?.success === 1 && data.response.steamid) {
      return json({ steamId: data.response.steamid }, 200, cors);
    }
    return json({ error: 'No Steam profile found for that custom URL' }, 404, cors);
  } catch {
    return json({ error: 'Failed to reach the Steam API' }, 502, cors);
  }
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Cache only successful lookups (avatars / resolved IDs rarely change).
      // Never cache errors: a 4xx/5xx with a long max-age would stick in the
      // browser for an hour and keep masking an already-fixed Worker or a
      // transient Steam hiccup — exactly the kind of stale error that makes a
      // redeploy look like it didn't work.
      'Cache-Control': status === 200 ? 'public, max-age=3600' : 'no-store',
      ...cors,
    },
  });
}
