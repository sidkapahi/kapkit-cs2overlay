// Raw shape of Leetify's official Public API response:
// GET https://api-public.cs-prod.leetify.com/v3/profile?steam64_id={id}
export interface LeetifyProfile {
  privacy_mode: string;
  winrate: number; // fraction, e.g. 0.6429
  total_matches: number;
  first_match_date: string;
  name: string;
  steam64_id: string;
  id: string;
  ranks: {
    leetify: number;
    premier: number | null;
    faceit: number | null;
    faceit_elo: number | null;
    wingman: number | null;
    renown: number | null;
    competitive: { map_name: string; rank: number }[];
  };
  rating: {
    aim: number;
    positioning: number;
    utility: number;
    clutch: number;
    opening: number;
    ct_leetify: number;
    t_leetify: number;
  };
  recent_matches: LeetifyMatch[];
}

export interface LeetifyMatch {
  id: string;
  data_source: string;
  outcome: 'win' | 'loss' | 'tie';
  rank: number | null;
  // Numeric game-mode id from Leetify (e.g. Premier vs Competitive), not a
  // label like 'premier'. Premier matches are detected by rank scale instead
  // (see api.ts), so this is kept only to mirror the raw payload shape.
  rank_type: number | null;
  map_name: string;
  leetify_rating: number;
  score: [number, number];
  preaim: number;
  reaction_time_ms: number;
  accuracy_enemy_spotted: number;
  accuracy_head: number;
  spray_accuracy: number;
  // Kills/deaths aren't in the profile payload — they come from the separate
  // /v2/matches/{id} endpoint and are attached after the fact (see api.ts).
  // Undefined when that per-match lookup hasn't run or failed.
  kills?: number;
  deaths?: number;
}

// Kept as an alias so widget.ts's existing rendering code doesn't need renaming.
export type LeetifyGame = LeetifyMatch;

// Shape of an entry from Leetify's match-list endpoint:
// GET /v3/profile/matches?steam64_id=... returns an array of these. Only the
// fields the widget needs — each match's full stats block is much larger.
export interface LeetifyMatchDetails {
  id: string;
  stats: LeetifyMatchPlayerStats[];
}

export interface LeetifyMatchPlayerStats {
  steam64_id: string;
  total_kills: number;
  total_deaths: number;
}

export interface RankTier {
  min: number;
  max: number;
  name: string;
  key: string;
  color: string;
  colorLight: string;
  gradient: string;
  // Premier badge index (prem_1..prem_7 in the Figma design), used to pick the
  // rank emblem shown behind the rating when the badge is enabled.
  badgeIndex: number;
  // Deep fill tone for the badge parallelogram.
  badgeBg: string;
  // Bright accent used for the badge slashes and the rating text (matches the
  // per-tier text colors in the Figma badge sheet).
  badgeAccent: string;
}

// The individual stats the widget can show. `showStats` gates the whole block;
// `stats` picks which of these appear (in this order), capped at STAT_MAX.
// `aim` is Premier-only (Leetify's aim rating); `adr`/`hs` are FACEIT-only —
// which keys are offered depends on the provider (see PROVIDER_STATS).
export type StatKey = 'kd' | 'avg' | 'aim' | 'winpct' | 'adr' | 'hs';

export const STAT_KEYS: StatKey[] = ['kd', 'avg', 'aim', 'winpct', 'adr', 'hs'];
export const STAT_LABELS: Record<StatKey, string> = {
  kd: 'K/D',
  avg: 'AVG',
  aim: 'AIM',
  winpct: 'WIN %',
  adr: 'ADR',
  hs: 'HS %',
};
// The widget only has room for three stat columns, so the picker is capped here.
export const STAT_MAX = 3;

// Which data source backs the overlay. Premier reads Leetify (Steam ID);
// FACEIT reads the FACEIT Data API via its proxy Worker (FACEIT nickname).
export type Provider = 'leetify' | 'faceit';

// The stat keys each provider can offer, in the customizer's display order.
// FACEIT has no aim rating; Premier (Leetify) has no ADR/HS.
export const PROVIDER_STATS: Record<Provider, StatKey[]> = {
  leetify: ['kd', 'avg', 'aim', 'winpct', 'hs'],
  faceit: ['kd', 'avg', 'adr', 'winpct', 'hs'],
};

// The default stat trio per provider. Premier keeps its original K/D·AVG·AIM;
// FACEIT swaps the (unavailable) aim slot for ADR.
export const DEFAULT_STATS_BY_PROVIDER: Record<Provider, StatKey[]> = {
  leetify: ['kd', 'avg', 'aim'],
  faceit: ['kd', 'avg', 'adr'],
};

// Streaming platforms whose live status can drive session-scoped W/L. Each has
// its own proxy Worker (see worker/), picked from the link the user pastes.
export type LivePlatform = 'twitch' | 'youtube' | 'kick';

export interface WidgetConfig {
  // Data source. Both providers are keyed by the same Steam ID — 'leetify'
  // (Premier, the default) reads Leetify; 'faceit' reads the FACEIT provider
  // (the Worker resolves the Steam ID to the FACEIT player).
  provider: Provider;
  steamId: string;
  // Live-session source. When a platform + channel are set, the W/L pills become
  // session-scoped: they reset when the channel goes live and freeze (keeping the
  // last session's record) when it goes offline. Empty platform = the old
  // rolling-window W/L over recent matches. `liveChannel` is the normalized
  // identifier that platform's proxy expects (a Twitch/Kick login, or a YouTube
  // @handle / channel id).
  livePlatform: '' | LivePlatform;
  liveChannel: string;
  showAvatar: boolean;
  // FACEIT only: show the country flag before the name (replaces the Avatar
  // toggle, which FACEIT mode doesn't use — the dial fills the left slot).
  showFlag: boolean;
  showName: boolean;
  showBadge: boolean;
  showChange: boolean;
  showWinLoss: boolean;
  showStats: boolean;
  // Which stats to show when showStats is on, in display order (max STAT_MAX).
  stats: StatKey[];
  showMatchHistory: boolean;
  matchCount: number;
  refreshInterval: number;
  // Design options.
  font: string;
  // Font weight applied to the widget's display text (100..900). 700 keeps the
  // original look; the stronger elements (rating, diff) render one step heavier.
  fontWeight: number;
  bgColor: string; // hex, e.g. '#141414'
  bgOpacity: number; // 0..100
  // Overlay corner radius in px — one of CORNER_RADII. 100 renders as a fully
  // rounded pill (the W/L chips round up to match).
  cornerRadius: CornerRadius;
}

// Corner radius presets offered in the customizer (Figma 154:2895 / 154:2926 /
// 154:2957 / 154:2988). 24 is the original look.
export const CORNER_RADII = [0, 24, 32, 100] as const;
export type CornerRadius = (typeof CORNER_RADII)[number];

export const DEFAULT_CONFIG: WidgetConfig = {
  provider: 'leetify',
  steamId: '',
  livePlatform: '',
  liveChannel: '',
  showAvatar: true,
  showFlag: true,
  showName: true,
  // Plain rank-coloured rating by default; the in-game styled badge is opt-in.
  showBadge: false,
  showChange: false,
  showWinLoss: true,
  showStats: true,
  stats: ['kd', 'avg', 'aim'],
  showMatchHistory: false,
  matchCount: 10,
  refreshInterval: 60,
  font: 'Inter',
  fontWeight: 700,
  bgColor: '#141414',
  bgOpacity: 100,
  cornerRadius: 24,
};
