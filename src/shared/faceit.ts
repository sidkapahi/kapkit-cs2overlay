import type { PremierData } from './api';
import { fetchWithTimeout } from './fetchWithTimeout';
import type { LeetifyGame } from './types';

// FACEIT provider client. The static site can't call the FACEIT Data API
// directly (secret key, no CORS), so everything goes through the FACEIT proxy
// Worker (worker/faceit-proxy.js), which resolves a Steam ID to the full overlay
// payload in one request. This module just calls that Worker and normalizes its
// response into the same `PremierData` shape the Premier (Leetify) path returns,
// so `render.ts` and `widget.ts` stay provider-agnostic.
const FACEIT_PROXY = import.meta.env.VITE_FACEIT_PROXY_URL as string | undefined;

// Shape the Worker returns (see worker/faceit-proxy.js response docs).
interface FaceitProfile {
  nickname: string;
  playerId: string;
  country: string | null;
  avatarUrl: string;
  elo: number | null;
  // Net ELO change across the recent window (sum of per-match changes, e.g.
  // +140); 0 when the Worker couldn't derive it.
  eloDiff: number | null;
  level: number | null;
  region: string | null;
  winRate: number | null; // 0..1
  kd: number | null;
  adr: number | null;
  hs: number | null; // 0..1
  wins: number | null; // TOTAL win/loss over the last ~100 matches
  losses: number | null;
  position: number | null;
  matches: FaceitMatch[];
}

interface FaceitMatch {
  matchId: string | null;
  outcome: 'win' | 'loss' | 'tie';
  kills: number | null;
  deaths: number | null;
  adr: number | null;
  hs: number | null;
  // ELO gained/lost in this match (e.g. +23); null when the Worker couldn't derive it.
  eloChange?: number | null;
}

// Builds a minimal LeetifyGame from a FACEIT match. `render.ts` reads only
// `outcome`, `kills`, `deaths`, and `eloChange` off recent games (for the history
// strip and the K/D · AVG stat cells), so the other fields are filled with inert defaults
// to satisfy the shared type without inventing data.
function toGame(m: FaceitMatch): LeetifyGame {
  return {
    id: m.matchId ?? '',
    data_source: 'faceit',
    outcome: m.outcome,
    rank: null,
    rank_type: null,
    map_name: '',
    leetify_rating: 0,
    score: [0, 0],
    preaim: 0,
    reaction_time_ms: 0,
    accuracy_enemy_spotted: 0,
    accuracy_head: 0,
    spray_accuracy: 0,
    kills: m.kills ?? undefined,
    deaths: m.deaths ?? undefined,
    eloChange: typeof m.eloChange === 'number' ? m.eloChange : undefined,
  };
}

// Resolves a FACEIT nickname to the player's Steam64 ID via the Worker, so the
// Account field can accept a FACEIT nickname / profile link and still key the
// rest of the app (both providers) off a Steam ID. Throws friendly messages the
// customizer can surface.
export async function resolveFaceitNickname(nickname: string): Promise<string> {
  const nick = nickname.trim();
  if (!nick) throw new Error('No FACEIT nickname provided');
  if (!FACEIT_PROXY) {
    throw new Error('FACEIT accounts need the FACEIT proxy — set VITE_FACEIT_PROXY_URL');
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(`${FACEIT_PROXY}?nickname=${encodeURIComponent(nick)}`, { cache: 'no-store' });
  } catch {
    throw new Error('Failed to reach the FACEIT proxy');
  }
  if (res.status === 404) throw new Error("Couldn't find that FACEIT account");
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const body = (await res.json()) as { steamId?: unknown };
  if (typeof body.steamId === 'string' && /^\d{17}$/.test(body.steamId)) return body.steamId;
  throw new Error("Couldn't resolve that FACEIT account");
}

// Fetches a FACEIT player's overlay data by Steam64 ID (the same identity
// Premier uses — the Worker resolves it to the FACEIT player) and normalizes it
// to PremierData. Throws Errors whose messages classifyFetchError() (in api.ts)
// maps to the same analytics reason codes as the Leetify path, so a FACEIT
// outage is measurable the same way.
export async function fetchFaceitData(steamId: string, history?: number): Promise<PremierData> {
  const id = steamId.trim();
  if (!id) throw new Error('No Steam ID provided');
  if (!FACEIT_PROXY) {
    throw new Error('need the FACEIT proxy — set VITE_FACEIT_PROXY_URL');
  }

  const params = new URLSearchParams({ steam64_id: id });
  // How many recent matches to pull (the Worker clamps to 1..20). Driven by the
  // stats toggle so the history strip gets the right depth.
  if (history != null && Number.isFinite(history)) params.set('history', String(Math.trunc(history)));

  let res: Response;
  try {
    res = await fetchWithTimeout(`${FACEIT_PROXY}?${params.toString()}`, { cache: 'no-store' });
  } catch {
    throw new Error('Failed to reach the FACEIT proxy');
  }

  // 404 = no FACEIT account linked to that Steam profile. Surface a friendly
  // message; classifyFetchError picks it up via the 404 branch.
  if (res.status === 404) {
    throw new Error("That Steam account has no FACEIT profile for CS2");
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`);

  const p = (await res.json()) as FaceitProfile;

  const recentGames = (Array.isArray(p.matches) ? p.matches : []).map(toGame);
  // TOTAL W/L comes from the Worker (tallied over the last ~100 matches); fall
  // back to counting the returned window if the Worker didn't provide it.
  const wins = p.wins ?? recentGames.filter((g) => g.outcome === 'win').length;
  const losses = p.losses ?? recentGames.filter((g) => g.outcome === 'loss').length;

  return {
    name: p.nickname ?? '',
    avatarUrl: p.avatarUrl ?? '',
    rating: p.elo ?? 0,
    // TOTAL-mode loss/gain: the net ELO across the recent window (the sum of the
    // per-match ELO changes the Worker has recorded — FACEIT exposes no per-match
    // ELO, so the Worker tracks it in KV). 0 when none are recorded yet, which
    // hides the pill. Live-session mode overrides this client-side with the ELO
    // gained/lost across the stream (see widget.ts).
    ratingDiff: p.eloDiff ?? 0,
    winRate: p.winRate ?? 0,
    wins,
    losses,
    recentGames,
    aimRating: 0, // FACEIT has no aim rating
    country: typeof p.country === 'string' && p.country ? p.country.toLowerCase() : undefined,
    skillLevel: p.level ?? undefined,
    leaderboardPosition: p.position ?? undefined,
    adr: p.adr ?? undefined,
    hsPct: p.hs ?? undefined,
  };
}
