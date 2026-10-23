// Session-scoped Win/Loss tracking, driven by stream live status.
//
// The default W/L pills tally every match in Leetify's recent window. When a
// live channel (Twitch/YouTube/Kick) is configured we instead want a *per-stream*
// record: it resets to 0-0 when the channel goes live, counts only matches
// finished during that stream, and freezes (keeping the last stream's record)
// once the channel goes offline.
//
// Leetify's `recent_matches` is a rolling window, so a naive "current total
// minus a snapshot total" undercounts a long session as early games fall out of
// the window. Instead we snapshot the set of match *ids* present at go-live
// (those are pre-session and never counted), then accumulate the outcome of any
// *new* id we see while live into a map keyed by id. Because outcomes are stored
// by id, a match still counts even after it later drops out of the window, and
// the whole thing survives an OBS source refresh via localStorage.

import type { LeetifyMatch } from './types';

export interface SessionState {
  // Last live status we acted on. Drives the go-live / go-offline transitions.
  live: boolean;
  // Match ids that already existed when the current session started. Counting
  // ignores these so a session begins cleanly at 0-0.
  preSessionIds: string[];
  // Outcomes of matches finished during the current session, keyed by match id.
  results: Record<string, 'win' | 'loss' | 'tie'>;
  // Rating (FACEIT ELO) snapshotted at go-live. FACEIT has no per-match ELO
  // delta from its API, so the "change" pill in FACEIT mode is derived as
  // current − this snapshot: the ELO gained/lost this stream. Undefined before
  // the first go-live.
  startRating?: number;
}

export interface SessionWinLoss {
  wins: number;
  losses: number;
  live: boolean;
  // 'session' → show these session numbers; 'fallback' → no session has begun
  // yet (channel never seen live and nothing counted), so the caller should show
  // the normal rolling-window W/L instead of an empty 0-0.
  mode: 'session' | 'fallback';
}

const STORAGE_PREFIX = 'cs2overlay:session:v1';

function emptyState(): SessionState {
  return { live: false, preSessionIds: [], results: {} };
}

// Advances the session state given the freshly polled live status and recent
// matches. `liveNow === null` means "status unknown" (e.g. the proxy blipped):
// we leave the live flag and the session untouched rather than misreading a
// transient failure as the stream ending. Pure — no I/O — so it's easy to reason
// about; persistence is handled by load/save around it.
export function advanceSession(
  prev: SessionState,
  liveNow: boolean | null,
  recent: LeetifyMatch[],
  currentRating?: number,
): SessionState {
  const state: SessionState = {
    live: prev.live,
    preSessionIds: [...prev.preSessionIds],
    results: { ...prev.results },
    startRating: prev.startRating,
  };

  if (liveNow === true && !prev.live) {
    // Go-live: start a fresh session. Every current match is pre-session, and
    // the current rating becomes the baseline for the session ELO change.
    state.live = true;
    state.preSessionIds = recent.map((m) => m.id);
    state.results = {};
    state.startRating = currentRating;
  } else if (liveNow === false && prev.live) {
    // Go-offline: freeze. Keep results as the last stream's record.
    state.live = false;
  }

  // Accumulate only while live. A finished match lingers in the window across
  // many polls, so missing a single poll (e.g. a null blip) never drops a game.
  //
  // `recent` is newest-first, so a session match is one that comes before
  // every pre-session match in it. Matches below the newest pre-session one
  // are older than the stream even when their ids weren't snapshotted: the
  // window can be deeper now than at go-live (it grew from 10 to 30 matches
  // when the stats window did, which counted 20 old matches as this stream's).
  // Those are skipped, and dropped from the results if an earlier poll counted
  // them, which repairs a record stored before this check.
  if (state.live) {
    const preSet = new Set(state.preSessionIds);
    const firstPre = recent.findIndex((m) => preSet.has(m.id));
    const cutoff = firstPre === -1 ? recent.length : firstPre;
    recent.forEach((m, i) => {
      if (i < cutoff) state.results[m.id] = m.outcome;
      else if (!preSet.has(m.id)) delete state.results[m.id];
    });
  }

  return state;
}

// Reduces a session state to the numbers the widget shows.
export function readWinLoss(state: SessionState): SessionWinLoss {
  let wins = 0;
  let losses = 0;
  for (const outcome of Object.values(state.results)) {
    if (outcome === 'win') wins++;
    else if (outcome === 'loss') losses++;
  }
  // Before the first go-live (and with nothing counted) there's no meaningful
  // session yet, so tell the caller to fall back to the rolling-window W/L.
  const mode: 'session' | 'fallback' =
    state.live || wins + losses > 0 ? 'session' : 'fallback';
  return { wins, losses, live: state.live, mode };
}

function storageKey(steamId: string, platform: string, channel: string): string {
  return `${STORAGE_PREFIX}:${steamId}:${platform}:${channel}`;
}

// Loads the stored session for this steamId + live channel. Any read failure
// (private mode, cleared storage, corrupt JSON) yields a clean empty session.
export function loadSession(steamId: string, platform: string, channel: string): SessionState {
  try {
    const raw = localStorage.getItem(storageKey(steamId, platform, channel));
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    return {
      live: typeof parsed.live === 'boolean' ? parsed.live : false,
      preSessionIds: Array.isArray(parsed.preSessionIds) ? parsed.preSessionIds : [],
      results: parsed.results && typeof parsed.results === 'object' ? parsed.results : {},
      startRating: typeof parsed.startRating === 'number' ? parsed.startRating : undefined,
    };
  } catch {
    return emptyState();
  }
}

// Persists the session. Best-effort: storage may be unavailable or full, in
// which case the session simply won't survive a refresh — never an error.
export function saveSession(
  steamId: string,
  platform: string,
  channel: string,
  state: SessionState,
): void {
  try {
    localStorage.setItem(storageKey(steamId, platform, channel), JSON.stringify(state));
  } catch {
    // ignore: session persistence is a convenience, not a requirement
  }
}

// The W/L of a stream that started at `startedAt` (ms epoch): the matches in
// `recent` that finished at or after it. The customizer's preview uses this to
// show the streamer's live record without the overlay's stored session (which
// lives in OBS's browser, not the one the customizer runs in). Null when any
// match lacks a finish time, so the caller falls back to advanceSession.
export function winLossSince(
  recent: LeetifyMatch[],
  startedAt: number,
): { wins: number; losses: number } | null {
  let wins = 0;
  let losses = 0;
  for (const m of recent) {
    const finished = m.finished_at ? Date.parse(m.finished_at) : NaN;
    if (isNaN(finished)) return null;
    if (finished < startedAt) continue;
    if (m.outcome === 'win') wins++;
    else if (m.outcome === 'loss') losses++;
  }
  return { wins, losses };
}
