import { fetchWithTimeout } from './fetchWithTimeout';
import type { LeetifyGame, LeetifyMatch, LeetifyMatchDetails, LeetifyProfile } from './types';

// Leetify's real, documented Public API (see https://api-public-docs.cs-prod.leetify.com/).
// The old cs-prod.leetify.com/api/profile/id/{steamId} endpoint this widget used to call
// doesn't exist on that API at all — hence the persistent 404s.
const API_BASE = 'https://api-public.cs-prod.leetify.com/v3/profile';
// Match-list endpoint. The profile payload has no kills/deaths, but this returns
// all recent matches in one call, each with a per-player `stats` array that does
// — keyed by steam64_id — so we join it back onto the profile's matches by id.
const MATCHES_BASE = 'https://api-public.cs-prod.leetify.com/v3/profile/matches';
const LEETIFY_KEY = import.meta.env.VITE_LEETIFY_KEY as string | undefined;

// Optional Leetify proxy Worker (worker/leetify-proxy.js). Leetify's public API
// sends NO CORS headers, so a browser — including OBS's Chromium browser source —
// can't read its responses directly: the fetch is blocked before any status is
// seen and surfaces as "Failed to fetch", the single most common overlay failure.
// When this is set the widget goes through the Worker instead, which adds CORS and
// keeps the (optional) API key server-side. When it's unset we fall back to the
// direct call — which works from non-browser tooling but is blocked in a browser.
const LEETIFY_PROXY = import.meta.env.VITE_LEETIFY_PROXY_URL as string | undefined;

// Builds the request for a Leetify lookup. Through the proxy Worker when one is
// configured (the profile at `?steam64_id=…`, the match list at the same URL
// with `&matches=1`), otherwise straight to Leetify's API with the optional key
// header. Keeping both shapes here means fetchPremierData/enrichWithKills don't
// have to know which mode is active.
function leetifyRequest(
  kind: 'profile' | 'matches',
  steamId: string,
): { url: string; init: RequestInit } {
  const id = encodeURIComponent(steamId);
  if (LEETIFY_PROXY) {
    const sep = LEETIFY_PROXY.includes('?') ? '&' : '?';
    const suffix = kind === 'matches' ? '&matches=1' : '';
    // `cache: no-store` so a stale/cached proxy error can't keep masking a fixed
    // Worker (the same reasoning as the vanity/avatar proxies).
    return { url: `${LEETIFY_PROXY}${sep}steam64_id=${id}${suffix}`, init: { cache: 'no-store' } };
  }
  const base = kind === 'matches' ? MATCHES_BASE : API_BASE;
  const headers: Record<string, string> = {};
  if (LEETIFY_KEY) headers._leetify_key = LEETIFY_KEY;
  return { url: `${base}?steam64_id=${id}`, init: { headers } };
}

// Optional Steam avatar proxy (a small Cloudflare Worker — see worker/README.md).
// Leetify's public API doesn't return an avatar, and the browser can't call
// Steam's Web API directly (needs a secret key, no CORS), so when this is set
// the widget fetches the avatar from the Worker instead.
const AVATAR_PROXY = import.meta.env.VITE_AVATAR_PROXY_URL as string | undefined;

// Lowest match `rank` we treat as a Premier CS Rating. Premier ratings run into
// the thousands, while Competitive and Wingman ranks are 1–18, so this cleanly
// separates a Premier match's rank from the small tier numbers.
const PREMIER_MIN_RANK = 1000;

export interface PremierData {
  name: string;
  avatarUrl: string;
  rating: number;
  // Premier rank-point swing from the previous Premier match to the most recent
  // one (e.g. +250). 0 when it can't be derived from the recent matches.
  ratingDiff: number;
  // Win / loss counts across the returned recent matches (ties excluded).
  wins: number;
  losses: number;
  recentGames: LeetifyGame[];
  aimRating: number;
  // FACEIT-only fields, unset in Premier (Leetify) mode. `render.ts` reads them
  // only when the widget's provider is 'faceit'.
  //
  // Lowercase ISO 3166-1 alpha-2 country code (drives the flag), e.g. 'ca'.
  country?: string;
  // FACEIT skill level 1–10; 10 is Challenger. Drives the rank dial.
  skillLevel?: number;
  // Challenger leaderboard position (the `#528` pill); only set for level 10.
  leaderboardPosition?: number;
  // FACEIT region code, lowercase (e.g. 'na'), and the player's leaderboard
  // position in that region and among its players from their country. The
  // name cycles through these after each refresh (see rankCycle.ts).
  region?: string;
  regionRank?: number;
  countryRank?: number;
}

// Maps a fetch/resolve failure to a coarse, non-PII reason code for analytics,
// so silent failures become measurable: an `api_5xx` / `api_rate_limited` spike
// means Leetify is down or throttling us (a real problem), while `no_premier`
// is just a visitor without Premier data (not a bug). Kept next to the code
// that throws these messages so the two stay in sync.
export function classifyFetchError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const api = /API error:\s*(\d+)/i.exec(msg);
  if (api) {
    const status = Number(api[1]);
    if (status === 429) return 'api_rate_limited';
    if (status >= 500) return 'api_5xx';
    if (status === 404) return 'api_404';
    return `api_${status}`;
  }
  if (/No Premier rank/i.test(msg)) return 'no_premier';
  if (/recognise that custom URL|recognize that custom URL/i.test(msg)) return 'vanity_not_found';
  if (/reach the Steam resolver|resolve custom URL|need the Steam proxy/i.test(msg)) return 'resolver_error';
  // A fetch that never got an HTTP response — the API host was unreachable (DNS,
  // CORS, offline, a proxy cold start, or an ad/tracking blocker eating the
  // request). Browsers word this differently: "Failed to fetch" (Chromium, so
  // OBS's CEF browser source), "NetworkError when attempting to fetch resource"
  // (Firefox), "Load failed" (Safari); our proxy wrappers rethrow it as
  // "Failed to reach the … proxy". These used to fall into `other`, hiding what
  // is in practice the single most common overlay failure.
  if (/Failed to fetch|NetworkError|Load failed|Failed to reach/i.test(msg)) return 'network_error';
  return 'other';
}

// A short, PII-free description of a failure, attached as `detail` on error
// analytics so the `other` bucket (and any future misclassification) is
// diagnosable instead of opaque. The messages we throw never contain the Steam
// ID — they're HTTP status strings ("API error: 500"), fixed copy ("No Premier
// rank found"), or the browser's own network-failure text — so the message is
// safe to send as-is. Truncated defensively so a freak long message can't bloat
// the event.
export function errorDetail(e: unknown): string {
  const name = e instanceof Error && e.name ? e.name : '';
  const msg = e instanceof Error ? e.message : String(e);
  return `${name ? name + ': ' : ''}${msg}`.slice(0, 140);
}

export async function fetchPremierData(steamId: string): Promise<PremierData> {
  const { url, init } = leetifyRequest('profile', steamId);
  let res: Response;
  try {
    res = await fetchWithTimeout(url, init);
  } catch {
    // A fetch that never got an HTTP response — the host was unreachable, or the
    // request stalled on a dead socket and hit our timeout. Word it after what
    // was actually called so the message points at the real culprit;
    // classifyFetchError maps both phrasings to `network_error`.
    throw new Error(LEETIFY_PROXY ? 'Failed to reach the Leetify proxy' : 'Failed to fetch');
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`);

  const data: LeetifyProfile = await res.json();

  if (data.ranks.premier == null) throw new Error('No Premier rank found');

  const recentGames = data.recent_matches ?? [];
  // Kills/deaths aren't in the profile payload, so fetch them from the match-list
  // endpoint (one call) and attach them to these matches. Runs alongside the
  // avatar lookup so both happen in parallel.
  const [avatarUrl] = await Promise.all([
    // Leetify's public API doesn't expose an avatar URL. If an avatar proxy is
    // configured we resolve it from the Steam Web API; otherwise this stays blank
    // and config.showAvatar hides the avatar slot entirely.
    fetchAvatarUrl(steamId),
    enrichWithKills(steamId, recentGames),
  ]);
  // Premier rank-point swing: the profile payload has no historical deltas, but
  // each match carries the CS Rating it ended at, so the diff between the two
  // most recent Premier matches is the last game's point change (e.g. +250).
  // recent_matches is newest-first, so [0] - [1] is that last game's swing.
  //
  // Premier matches are identified by their rank *scale*, not by `rank_type`:
  // that field is a numeric game-mode id (not the string 'premier' the code
  // used to test for — which never matched, so the diff was always 0). Only
  // Premier uses a CS Rating in the thousands; Competitive and Wingman ranks
  // are 1–18, and FACEIT (whose ELO is also large) is excluded explicitly.
  const premierRanks = recentGames
    .filter(
      (g) =>
        typeof g.rank === 'number' &&
        g.rank >= PREMIER_MIN_RANK &&
        !/faceit/i.test(g.data_source ?? ''),
    )
    .map((g) => g.rank as number);
  const ratingDiff = premierRanks.length >= 2 ? premierRanks[0] - premierRanks[1] : 0;

  // Win / loss tallies for the TOTAL pills — counted over the Premier matches in
  // the recent window (Leetify returns up to ~100), the closest the API allows
  // to a season total. recent_matches mixes modes, so filter to Premier the same
  // way the rating-diff does (a CS Rating in the thousands, FACEIT excluded);
  // ties don't count. (Live-session mode overrides these with the stream record.)
  const premierGames = recentGames.filter(
    (g) =>
      typeof g.rank === 'number' &&
      g.rank >= PREMIER_MIN_RANK &&
      !/faceit/i.test(g.data_source ?? ''),
  );
  const wins = premierGames.filter((g) => g.outcome === 'win').length;
  const losses = premierGames.filter((g) => g.outcome === 'loss').length;

  return {
    name: data.name,
    avatarUrl,
    rating: data.ranks.premier,
    ratingDiff,
    wins,
    losses,
    recentGames,
    aimRating: data.rating.aim,
  };
}

// Attaches kills/deaths to each match from the match-list endpoint, which the
// profile payload doesn't carry. One request returns every recent match with a
// per-player `stats` array; we index the player's kills/deaths by match id and
// join them onto the passed matches (mutating them). Best-effort: if the request
// fails, matches keep undefined kills/deaths and the stats row falls back.
async function enrichWithKills(
  steamId: string,
  matches: LeetifyMatch[],
): Promise<void> {
  try {
    const { url, init } = leetifyRequest('matches', steamId);
    const res = await fetchWithTimeout(url, init);
    if (!res.ok) return;
    const details = (await res.json()) as LeetifyMatchDetails[];

    const byId = new Map<string, { kills: number; deaths: number }>();
    for (const detail of details) {
      const me = detail.stats?.find((p) => p.steam64_id === steamId);
      if (me) byId.set(detail.id, { kills: me.total_kills, deaths: me.total_deaths });
    }

    for (const m of matches) {
      const stat = byId.get(m.id);
      if (stat) {
        m.kills = stat.kills;
        m.deaths = stat.deaths;
      }
    }
  } catch {
    // Leave kills/deaths undefined; the widget handles missing data.
  }
}

// Resolves a Steam custom (vanity) URL name (e.g. the `gabelogannewell` in
// steamcommunity.com/id/gabelogannewell) to a Steam64 ID via the proxy Worker.
// Steam's ResolveVanityURL API needs the secret key, so it can only run
// server-side — the same Worker used for avatars also handles this. Throws a
// friendly message when the proxy isn't configured or the name can't be
// resolved, so the customizer can surface it to the user.
export async function resolveVanityUrl(vanity: string): Promise<string> {
  if (!AVATAR_PROXY) {
    throw new Error(
      "Custom profile URLs need the Steam proxy. Paste your Steam64 ID or a " +
        "steamcommunity.com/profiles/… link instead.",
    );
  }

  let res: Response;
  try {
    // `cache: no-store` so the browser never reads (or writes) a cached Worker
    // response for this URL. An out-of-date Worker used to send its errors with
    // a 1-hour max-age, and that stale error would otherwise keep masking a
    // Worker that's since been fixed.
    res = await fetchWithTimeout(`${AVATAR_PROXY}?vanity=${encodeURIComponent(vanity)}`, {
      cache: "no-store",
    });
  } catch {
    throw new Error("Couldn't reach the Steam resolver");
  }

  let body: { steamId?: unknown; error?: unknown } = {};
  try {
    body = (await res.json()) as { steamId?: unknown; error?: unknown };
  } catch {
    // Non-JSON response; fall through to status-based handling below.
  }

  if (res.ok && typeof body.steamId === "string" && /^\d{17}$/.test(body.steamId)) {
    return body.steamId;
  }

  // 404 means the name genuinely has no matching Steam profile. Any other
  // status usually means the proxy Worker itself is misconfigured or out of
  // date — e.g. a Worker deployed before vanity support was added doesn't
  // understand `?vanity=` and replies with an "Invalid or missing steam64_id"
  // error. Surface the Worker's own message so that's diagnosable instead of
  // masking every failure as "no profile found".
  if (res.status === 404) {
    throw new Error(
      "Steam didn't recognise that custom URL name — check it's exact, or " +
        "paste your Steam64 ID / a /profiles/… link instead",
    );
  }
  const detail =
    typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
  throw new Error(`Couldn't resolve custom URL — ${detail}`);
}

// Resolves a Steam avatar URL via the optional proxy Worker. Never throws:
// if the proxy is unset, unreachable, or the profile is private, the widget
// just renders without an avatar rather than failing the whole update.
async function fetchAvatarUrl(steamId: string): Promise<string> {
  if (!AVATAR_PROXY) return '';
  try {
    const res = await fetchWithTimeout(`${AVATAR_PROXY}?steam64_id=${encodeURIComponent(steamId)}`);
    if (!res.ok) return '';
    const body = (await res.json()) as { avatarUrl?: unknown };
    return typeof body.avatarUrl === 'string' ? body.avatarUrl : '';
  } catch {
    return '';
  }
}
