// FACEIT rank dials for the overlay's FACEIT mode — the level 1–10 skill icons
// and the Challenger emblem. Loaded from assets/faceit/*.svg via Vite's `?raw`
// import (same pattern as socialLogos.ts), so the raw SVG markup is inlined into
// the bundle at build time — no network request, which OBS browser sources can't
// reliably resolve. To use your own art, replace the files in assets/faceit/;
// see assets/faceit/README.md.
//
// The level number is baked into each dial's art (as a vector path, coloured for
// that tier), so the widget doesn't draw it. The Challenger emblem has no number
// — its `#528` leaderboard-position pill is drawn dynamically (see render.ts).
import level1 from '../../assets/faceit/level-1.svg?raw';
import level2 from '../../assets/faceit/level-2.svg?raw';
import level3 from '../../assets/faceit/level-3.svg?raw';
import level4 from '../../assets/faceit/level-4.svg?raw';
import level5 from '../../assets/faceit/level-5.svg?raw';
import level6 from '../../assets/faceit/level-6.svg?raw';
import level7 from '../../assets/faceit/level-7.svg?raw';
import level8 from '../../assets/faceit/level-8.svg?raw';
import level9 from '../../assets/faceit/level-9.svg?raw';
import level10 from '../../assets/faceit/level-10.svg?raw';
import challenger from '../../assets/faceit/challenger.svg?raw';

const DIALS: Record<number, string> = {
  1: level1,
  2: level2,
  3: level3,
  4: level4,
  5: level5,
  6: level6,
  7: level7,
  8: level8,
  9: level9,
  10: level10,
};

// The default Challenger colour (emblem + position pill). The top three
// leaderboard spots get their own medal colours instead.
const CHALLENGER_DEFAULT = '#e80128';
const CHALLENGER_TOP: Record<number, string> = {
  1: 'rgb(255, 211, 54)', // gold
  2: 'rgb(222, 245, 255)', // silver / ice
  3: 'rgb(255, 114, 54)', // bronze
};

// The Challenger colour for a leaderboard position — #1/#2/#3 get medal colours,
// everyone else the default red. Used for both the emblem fill and the position
// pill background.
export function challengerColor(position: number | undefined): string {
  return (position != null && CHALLENGER_TOP[position]) || CHALLENGER_DEFAULT;
}

// Each level's tier colour, matching the colour baked into its dial art
// (1 grey-white, 2–3 green, 4–7 yellow, 8–9 orange, 10 red).
const LEVEL_COLORS: Record<number, string> = {
  1: '#eeeeee',
  2: '#1ce400',
  3: '#1ce400',
  4: '#ffc800',
  5: '#ffc800',
  6: '#ffc800',
  7: '#ffc800',
  8: '#ff6309',
  9: '#ff6309',
  10: '#fe1f00',
};

// The ELO text colour for a player: the Challenger colour (red, or the #1/#2/#3
// medal colour) when they hold a leaderboard position, otherwise their level's
// tier colour — so the number always matches the dial beside it.
export function faceitEloColor(
  level: number | undefined,
  isChallenger: boolean,
  position?: number,
): string {
  if (isChallenger) return challengerColor(position);
  return LEVEL_COLORS[clampLevel(level)];
}

// Clamps any skill level to the valid 1–10 range so an unexpected value still
// resolves to a dial rather than nothing.
function clampLevel(level: number | undefined): number {
  if (!Number.isFinite(level as number)) return 1;
  return Math.max(1, Math.min(10, Math.round(level as number)));
}

// The dial SVG for a player: the Challenger emblem when they hold a leaderboard
// position, otherwise the level 1–10 dial. For Challenger the emblem's red is
// recoloured to the position's medal colour (#1/#2/#3); the level dials keep
// their baked-in colours.
export function faceitDialSvg(
  level: number | undefined,
  isChallenger: boolean,
  position?: number,
): string {
  if (isChallenger) {
    return challenger.replace(/#e80128/gi, challengerColor(position));
  }
  return DIALS[clampLevel(level)];
}
