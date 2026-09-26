// Cloudflare Worker: YouTube live-status proxy
//
// The widget is a static GitHub Pages site, so it can't check YouTube live
// status itself: the YouTube Data API v3 needs an API key that must stay
// server-side. This Worker keeps the key on Cloudflare and answers a single
// lookup, adding the CORS headers the browser needs:
//   • GET ?youtube=<@handle | UC… id | legacy name>  → { live: bool }
//
// It's deliberately separate from the other proxies so each platform's
// credentials live on their own Worker.
//
// ⚠️ Quota: the YouTube Data API gives 10,000 units/day by default, and the
// live check (search.list) costs 100 units per call. The widget polls every
// ~15s per viewer, which would blow the quota almost instantly — so this Worker
// caches the live result at the edge (caches.default) for LIVE_TTL seconds and
// caches handle→channel-id resolution in memory. Real API calls happen at most
// ~once per channel per LIVE_TTL per Cloudflare colo. If you outgrow the free
// quota, request an increase from Google (a compliance form) rather than
// lowering the cache.
//
// Setup (see worker/README.md for details):
//   1. Create a project in the Google Cloud Console, enable "YouTube Data API
//      v3", and create an API key.
//   2. Deploy this Worker:
//        wrangler deploy --config wrangler.youtube.toml
//   3. Add the key as a secret:
//        wrangler secret put YOUTUBE_API_KEY --config wrangler.youtube.toml
//   4. Point the widget at this Worker's URL via VITE_YOUTUBE_PROXY_URL
//      (see the repo README).

// Only these site origins may call the Worker from a browser. CORS is what stops
// other websites from spending your YouTube quota. Add or remove entries here
// (scheme + host only, no trailing slash or path).
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

// How long a live-status answer is reused before we hit the API again. Bigger =
// cheaper (less quota) but slower to notice a go-live / go-offline transition.
const LIVE_TTL = 60; // seconds

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
    const youtube = url.searchParams.get('youtube');
    if (youtube !== null) return resolveYouTubeLive(youtube, env, cors);

    return json({ error: 'Missing youtube query parameter' }, 400, cors);
  },
};

// Is `channel` currently live? `channel` is an @handle, a UC… channel id, or a
// legacy custom/user name. We resolve it to a channel id (cached), then ask
// search.list for a live broadcast on that channel (cached at the edge).
async function resolveYouTubeLive(channel, env, cors) {
  const raw = channel.trim();
  // Accept @handles, UC… ids, and legacy names; reject anything with characters
  // that could smuggle extra query params.
  if (!/^@?[A-Za-z0-9._-]{2,64}$/.test(raw) && !/^UC[A-Za-z0-9_-]{22}$/.test(raw)) {
    return json({ error: 'Invalid YouTube channel' }, 400, cors);
  }

  if (!env.YOUTUBE_API_KEY) {
    // Not configured — tell the widget so it falls back to rolling-window W/L.
    return json({ error: 'Worker is missing the YouTube API key' }, 501, cors);
  }

  let channelId;
  try {
    channelId = await resolveChannelId(raw, env);
  } catch {
    return json({ error: 'Failed to resolve YouTube channel' }, 502, cors);
  }
  if (!channelId) return json({ error: 'YouTube channel not found' }, 404, cors);

  try {
    const live = await isChannelLive(channelId, env);
    return json({ live }, 200, cors);
  } catch {
    return json({ error: 'Failed to reach the YouTube API' }, 502, cors);
  }
}

// channel identifier → channel id, cached in memory for RESOLVE_TTL. A UC… id is
// already a channel id. @handles and legacy names cost 1 quota unit via
// channels.list (much cheaper than the 100-unit search fallback).
const RESOLVE_TTL = 6 * 60 * 60 * 1000; // 6h in ms
const ID_CACHE = new Map(); // key(lowercased) → { value: string|null, expiresAt: ms }

async function resolveChannelId(raw, env) {
  if (/^UC[A-Za-z0-9_-]{22}$/.test(raw)) return raw;

  const key = raw.toLowerCase();
  const now = Date.now();
  const hit = ID_CACHE.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const handle = raw.replace(/^@+/, '');
  let id = null;

  // Modern channels resolve by handle (1 unit). Fall back to the legacy username
  // lookup (1 unit), then a search (100 units) as a last resort.
  id =
    (await channelsLookup(`forHandle=@${encodeURIComponent(handle)}`, env)) ||
    (await channelsLookup(`forUsername=${encodeURIComponent(handle)}`, env)) ||
    (await searchChannelId(handle, env));

  ID_CACHE.set(key, { value: id, expiresAt: now + RESOLVE_TTL });
  return id;
}

async function channelsLookup(query, env) {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=id&${query}&key=${env.YOUTUBE_API_KEY}`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  const item = Array.isArray(data?.items) ? data.items[0] : null;
  return item?.id ?? null;
}

async function searchChannelId(term, env) {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(
      term,
    )}&key=${env.YOUTUBE_API_KEY}`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  const item = Array.isArray(data?.items) ? data.items[0] : null;
  return item?.id?.channelId ?? item?.snippet?.channelId ?? null;
}

// Live check for a resolved channel id, cached at the edge for LIVE_TTL so every
// viewer's poll doesn't spend quota. search.list with eventType=live returns an
// entry only while the channel has a live broadcast.
async function isChannelLive(channelId, env) {
  const cache = caches.default;
  const cacheKey = new Request(`https://yt-live-cache.internal/${channelId}`);

  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.json();
    return !!body.live;
  }

  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(
      channelId,
    )}&eventType=live&type=video&maxResults=1&key=${env.YOUTUBE_API_KEY}`,
  );
  if (!res.ok) throw new Error(`youtube ${res.status}`);
  const data = await res.json();
  const live = Array.isArray(data?.items) && data.items.length > 0;

  // Store the boolean in the edge cache for LIVE_TTL seconds.
  await cache.put(
    cacheKey,
    new Response(JSON.stringify({ live }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `max-age=${LIVE_TTL}`,
      },
    }),
  );
  return live;
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // The browser must never cache the live status (the edge cache above is
      // what protects the quota); a cached "live" would linger after go-offline.
      'Cache-Control': 'no-store',
      ...cors,
    },
  });
}
