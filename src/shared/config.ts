import {
  CORNER_RADII,
  DEFAULT_CONFIG,
  DEFAULT_STATS_BY_PROVIDER,
  PROVIDER_STATS,
  STAT_MAX,
  type CornerRadius,
  type LivePlatform,
  type Provider,
  type StatKey,
  type WidgetConfig,
} from './types';

export interface LiveChannel {
  platform: LivePlatform;
  channel: string;
}

// Keeps only unique stat keys valid for this provider, in the order given,
// capped at STAT_MAX. `allowed` is the provider's offered set (PROVIDER_STATS),
// so a stale URL carrying, say, `aim` in FACEIT mode drops it rather than
// rendering an empty cell.
function sanitizeStats(keys: string[], allowed: StatKey[]): StatKey[] {
  const seen = new Set<StatKey>();
  for (const k of keys) {
    if ((allowed as string[]).includes(k)) seen.add(k as StatKey);
  }
  return [...seen].slice(0, STAT_MAX);
}

// Normalizes whatever the user types for their Twitch channel — a bare login, a
// twitch.tv/<name> link, or an @handle — into the lowercase login Twitch's API
// expects. Returns '' for anything that isn't a valid login (4–25 chars of
// letters, digits, or underscores) so an unusable value simply disables the
// session feature rather than firing broken lookups.
export function normalizeTwitchLogin(raw: string): string {
  let s = raw.trim().toLowerCase();
  // Pull the channel name out of a pasted URL, e.g. https://twitch.tv/foo?x=1.
  const urlMatch = /(?:twitch\.tv\/)([^/?#]+)/.exec(s);
  if (urlMatch) s = urlMatch[1];
  s = s.replace(/^@/, '');
  return /^[a-z0-9_]{4,25}$/.test(s) ? s : '';
}

// Normalizes a YouTube channel out of whatever the user pastes: a channel URL
// (…/@handle, …/channel/UC…, …/c/name, …/user/name), a bare @handle, or a bare
// channel id. A UCxxx id is kept verbatim (channel ids are case-sensitive);
// anything else is reduced to an @handle. The proxy Worker does the actual
// handle/username → channel-id resolution, so we just hand it the identifier.
// Returns '' when nothing usable is found (which disables the session feature).
export function normalizeYouTubeChannel(raw: string): string {
  let s = raw.trim();
  const urlMatch =
    /youtube\.com\/(@[^/?#]+|channel\/[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)/i.exec(s);
  if (urlMatch) {
    s = urlMatch[1].replace(/^(?:channel|c|user)\//i, '');
  }
  // A channel id: UC followed by 22 URL-safe base64 chars, case-sensitive.
  if (/^UC[A-Za-z0-9_-]{22}$/.test(s)) return s;
  // Otherwise treat it as a handle (legacy /c/ and /user/ names resolve the same
  // way through the proxy's search fallback).
  const handle = s.replace(/^@+/, '');
  return /^[A-Za-z0-9._-]{3,30}$/.test(handle) ? `@${handle}` : '';
}

// Normalizes a Kick channel out of a kick.com/<slug> link, an @slug, or a bare
// slug. Kick slugs are lowercase letters, digits, and underscores.
export function normalizeKickSlug(raw: string): string {
  let s = raw.trim().toLowerCase();
  const urlMatch = /kick\.com\/([^/?#]+)/.exec(s);
  if (urlMatch) s = urlMatch[1];
  s = s.replace(/^@/, '');
  return /^[a-z0-9_]{3,25}$/.test(s) ? s : '';
}

// Normalizes an already-known platform+channel pair (e.g. from a widget URL).
// Returns null when the channel is unusable for that platform.
export function normalizeLiveChannel(platform: string, channel: string): LiveChannel | null {
  switch (platform) {
    case 'twitch': {
      const c = normalizeTwitchLogin(channel);
      return c ? { platform: 'twitch', channel: c } : null;
    }
    case 'youtube': {
      const c = normalizeYouTubeChannel(channel);
      return c ? { platform: 'youtube', channel: c } : null;
    }
    case 'kick': {
      const c = normalizeKickSlug(channel);
      return c ? { platform: 'kick', channel: c } : null;
    }
    default:
      return null;
  }
}

// Detects which platform a pasted value points at, then normalizes it. A URL
// picks the platform by host; a bare handle with no recognizable host is treated
// as Twitch, matching the widget's original single-platform behaviour. Returns
// null when nothing usable can be extracted.
export function parseLiveInput(raw: string): LiveChannel | null {
  const s = raw.trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
    return normalizeLiveChannel('youtube', s);
  }
  if (lower.includes('kick.com')) {
    return normalizeLiveChannel('kick', s);
  }
  return normalizeLiveChannel('twitch', s);
}

// How many recent matches the FACEIT provider should fetch: 10 when the stats
// block is shown, 5 when it isn't (per the design — a shorter history strip),
// bounded by the configured matchCount.
export function faceitHistoryCount(config: WidgetConfig): number {
  return config.showStats ? config.matchCount : Math.min(5, config.matchCount);
}

export function configToParams(config: WidgetConfig): URLSearchParams {
  const params = new URLSearchParams();
  // Identity is the Steam ID for both providers; `provider` selects the data
  // source and is only encoded for the non-default (FACEIT).
  params.set('steamId', config.steamId);
  if (config.provider === 'faceit') params.set('provider', 'faceit');
  // The live source drives session-scoped W/L; only include it when set. Encoded
  // as `live=<platform>:<channel>`, e.g. `live=twitch:kapowhi`.
  if (config.livePlatform && config.liveChannel) {
    params.set('live', `${config.livePlatform}:${config.liveChannel}`);
  }
  if (!config.showAvatar) params.set('avatar', '0');
  // Flag defaults ON (FACEIT only); encode the OFF case.
  if (!config.showFlag) params.set('flag', '0');
  if (!config.showName) params.set('name', '0');
  // Badge defaults OFF now, so encode the ON case explicitly.
  if (config.showBadge) params.set('badge', '1');
  if (!config.showChange) params.set('change', '0');
  if (!config.showWinLoss) params.set('wl', '0');
  // Stats: 'off' when the block is hidden; otherwise the chosen list, but only
  // when it differs from the default trio (keeps the common URL clean).
  if (!config.showStats) {
    params.set('stats', 'off');
  } else if (config.stats.join(',') !== DEFAULT_STATS_BY_PROVIDER[config.provider].join(',')) {
    params.set('stats', config.stats.join(','));
  }
  // Match history defaults OFF now, so encode the ON case explicitly.
  if (config.showMatchHistory) params.set('history', '1');
  if (config.matchCount !== DEFAULT_CONFIG.matchCount) {
    params.set('matchCount', String(config.matchCount));
  }
  if (config.refreshInterval !== DEFAULT_CONFIG.refreshInterval) {
    params.set('refresh', String(config.refreshInterval));
  }
  if (config.font !== DEFAULT_CONFIG.font) params.set('font', config.font);
  if (config.fontWeight !== DEFAULT_CONFIG.fontWeight) {
    params.set('fw', String(config.fontWeight));
  }
  if (config.bgColor !== DEFAULT_CONFIG.bgColor) {
    params.set('bg', config.bgColor.replace(/^#/, ''));
  }
  if (config.bgOpacity !== DEFAULT_CONFIG.bgOpacity) {
    params.set('bgo', String(config.bgOpacity));
  }
  if (config.cornerRadius !== DEFAULT_CONFIG.cornerRadius) {
    params.set('radius', String(config.cornerRadius));
  }
  return params;
}

// A compact, stable string that identifies a *setup* — every visible setting
// except the identifying ones (steamId, live source). Because configToParams
// only encodes values that differ from the defaults, an all-default setup
// fingerprints as 'defaults'. Keys are sorted so the same choices always map to
// the same string, which is what lets analytics rank the most common combos:
// send this as one event property and break down by it in PostHog to rank combos.
export function settingsFingerprint(config: WidgetConfig): string {
  const params = configToParams(config);
  params.delete('steamId');
  params.delete('live');
  params.sort();
  return params.toString() || 'defaults';
}

export function paramsToConfig(params: URLSearchParams): WidgetConfig {
  const provider: Provider = params.get('provider') === 'faceit' ? 'faceit' : 'leetify';

  // Stats: 'off' hides the block; a comma list picks specific stats; absent uses
  // the provider's default trio. The comma list is filtered to the provider's
  // offered keys so a mismatched key from an old/edited URL is dropped.
  const statsParam = params.get('stats');
  let showStats = true;
  let stats = [...DEFAULT_STATS_BY_PROVIDER[provider]];
  if (statsParam === 'off' || statsParam === '0') {
    showStats = false;
  } else if (statsParam) {
    const parsed = sanitizeStats(statsParam.split(','), PROVIDER_STATS[provider]);
    if (parsed.length > 0) stats = parsed;
  }

  const bg = params.get('bg');
  const bgo = params.get('bgo');
  const fw = parseInt(params.get('fw') ?? '', 10);
  const radius = parseInt(params.get('radius') ?? '', 10);

  // Live source: `live=<platform>:<channel>` on new URLs; fall back to the legacy
  // `twitch=<login>` param so overlay URLs shared before this change keep working.
  let live: LiveChannel | null = null;
  const liveRaw = params.get('live');
  if (liveRaw) {
    const sep = liveRaw.indexOf(':');
    if (sep > 0) live = normalizeLiveChannel(liveRaw.slice(0, sep), liveRaw.slice(sep + 1));
  } else if (params.get('twitch')) {
    live = normalizeLiveChannel('twitch', params.get('twitch') ?? '');
  }

  return {
    provider,
    steamId: params.get('steamId') ?? DEFAULT_CONFIG.steamId,
    livePlatform: live?.platform ?? '',
    liveChannel: live?.channel ?? '',
    showAvatar: params.get('avatar') !== '0',
    showFlag: params.get('flag') !== '0',
    showName: params.get('name') !== '0',
    showBadge: params.get('badge') === '1',
    showChange: params.get('change') !== '0',
    showWinLoss: params.get('wl') !== '0',
    showStats,
    stats,
    showMatchHistory: params.get('history') === '1',
    matchCount: parseInt(params.get('matchCount') ?? String(DEFAULT_CONFIG.matchCount), 10),
    refreshInterval: parseInt(params.get('refresh') ?? String(DEFAULT_CONFIG.refreshInterval), 10),
    font: params.get('font') ?? DEFAULT_CONFIG.font,
    fontWeight:
      Number.isFinite(fw) && fw >= 100 && fw <= 900 ? fw : DEFAULT_CONFIG.fontWeight,
    bgColor: bg ? `#${bg.replace(/^#/, '')}` : DEFAULT_CONFIG.bgColor,
    bgOpacity: bgo != null ? Math.max(0, Math.min(100, parseInt(bgo, 10) || 0)) : DEFAULT_CONFIG.bgOpacity,
    cornerRadius: (CORNER_RADII as readonly number[]).includes(radius)
      ? (radius as CornerRadius)
      : DEFAULT_CONFIG.cornerRadius,
  };
}
