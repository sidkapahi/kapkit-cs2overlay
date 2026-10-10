import type { PremierData } from './api';
import type { SkeletonHint } from './render';

// Remembers the shape of each player's last card (name, flag, match count) so
// the next load's skeleton is the exact size of the card that replaces it — no
// jump when the data lands on a refreshed source or a new-deploy reload.
// Per Steam ID and provider, since the Steam name and FACEIT nickname differ.

const PREFIX = 'cs2overlay:skeleton';

const key = (steamId: string, provider: string) => `${PREFIX}:${provider}:${steamId}`;

export function loadSkeletonHint(steamId: string, provider: string): SkeletonHint | null {
  try {
    const raw = localStorage.getItem(key(steamId, provider));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SkeletonHint>;
    if (typeof parsed.name !== 'string' || typeof parsed.games !== 'number') return null;
    return {
      name: parsed.name,
      country: typeof parsed.country === 'string' ? parsed.country : undefined,
      games: parsed.games,
    };
  } catch {
    return null;
  }
}

export function saveSkeletonHint(steamId: string, provider: string, data: PremierData): void {
  const hint: SkeletonHint = { name: data.name, country: data.country, games: data.recentGames.length };
  try {
    localStorage.setItem(key(steamId, provider), JSON.stringify(hint));
  } catch {
    // Storage blocked or full: the skeleton just falls back to a stand-in name.
  }
}
