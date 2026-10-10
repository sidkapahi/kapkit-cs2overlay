// Live-status lookup across streaming platforms, each via its own proxy Worker.
//
// Checking whether a channel is live needs credentials that can't live in a
// browser (Twitch/Kick use a client id + secret; YouTube uses an API key), so a
// small Cloudflare Worker per platform holds the secret, talks to the platform
// API, and answers a single lookup: `GET {PROXY}?<param>=<channel>` → { live }.
// Twitch and Kick also send the stream's `category` (game) while live, which
// goes on the overlay's live analytics events so PostHog's Live Now tile can
// keep to CS2 streams.
// The widget just picks the proxy for the configured platform and asks it.

import { fetchWithTimeout } from './fetchWithTimeout';
import type { LivePlatform } from './types';

// The live check polls every 15s, so cap a stalled request well under that to
// avoid one hung poll overlapping the next.
const LIVE_FETCH_TIMEOUT_MS = 10000;

// Proxy Worker URL per platform, injected at build time. Any left unset simply
// disables that platform's live check (the widget falls back to rolling W/L).
const PROXIES: Record<LivePlatform, string | undefined> = {
  twitch: import.meta.env.VITE_TWITCH_PROXY_URL as string | undefined,
  youtube: import.meta.env.VITE_YOUTUBE_PROXY_URL as string | undefined,
  kick: import.meta.env.VITE_KICK_PROXY_URL as string | undefined,
};

// Query-param name each Worker expects for the channel identifier.
const PARAMS: Record<LivePlatform, string> = {
  twitch: 'twitch',
  youtube: 'youtube',
  kick: 'kick',
};

// True when a live check can actually be performed for the given platform (its
// proxy URL is configured). An empty platform is never available.
export function liveCheckAvailable(platform: '' | LivePlatform): boolean {
  return !!platform && !!PROXIES[platform];
}

export interface LiveStatus {
  live: boolean;
  // The stream's category/game name ('' when offline or the platform doesn't
  // report one, e.g. YouTube).
  category: string;
}

// Resolves whether the given channel is currently live on the given platform.
// Never throws: on a missing proxy, network error, or unexpected payload it
// returns `null`, which the caller treats as "status unknown" and leaves the
// session state untouched (so a transient blip can't be misread as the stream
// ending).
export async function fetchLive(
  platform: '' | LivePlatform,
  channel: string,
): Promise<LiveStatus | null> {
  if (!platform || !channel) return null;
  const proxy = PROXIES[platform];
  if (!proxy) return null;
  try {
    const res = await fetchWithTimeout(
      `${proxy}?${PARAMS[platform]}=${encodeURIComponent(channel)}`,
      { cache: 'no-store' },
      LIVE_FETCH_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { live?: unknown; category?: unknown };
    if (typeof body.live !== 'boolean') return null;
    const category = typeof body.category === 'string' ? body.category : '';
    return { live: body.live, category };
  } catch {
    return null;
  }
}
