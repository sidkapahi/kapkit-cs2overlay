import type { PremierData } from './api';
import { brandLogoSrc } from './brandLogo';
import { defaultAvatarSrc } from './defaultAvatar';
import { challengerPosColor, faceitDialSvg, faceitEloColor } from './faceitRanks';
import { flagUrl } from './flags';
import { fontStack } from './fonts';
import { formatRating, getRankTier } from './ranks';
import { STAT_LABELS, type RankTier, type StatKey, type WidgetConfig } from './types';

// Escapes user-controlled text (the player name) before it goes into innerHTML.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Directional arrow for the rating change (rank loss/gain). Recreated inline
// from the Figma "ArrowUpRight" icon so the exported widget stays
// self-contained (no external asset). The loss arrow ("ArrowDownRight") is the
// same mark turned 90° clockwise, so it's one SVG rotated in CSS
// (.rating-diff.negative .diff-arrow), which lets the live widget swing it
// between the two when a gain flips to a loss. `currentColor` inherits the
// diff's positive/negative tint. The viewBox is the full 48×48 design frame, so
// the arrow keeps the padding that sits it inset in its box (icon ≈ 1.2× the
// number, per .diff-arrow) and carries its built-in gap to the number —
// matching Figma 70:1419 / 70:1413. To swap in a custom mark, replace the
// paths here.
const DIFF_ARROW = `<svg class="diff-arrow" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 36L36 12" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.5 12H36V31.5" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// The Premier rank emblem shown behind the rating when the badge is enabled — a
// right-leaning parallelogram with the tier's deep fill and two bright "//"
// slashes on the left, recreated from the Figma badge sheet (prem_1..prem_7).
// preserveAspectRatio="none" lets the vector stretch to the rating box while the
// box keeps the source 206:74 ratio, so the lean stays true.
export function badgeSvg(tier: RankTier): string {
  return `<svg class="badge-svg" viewBox="0 0 206 74" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <polygon points="20,0 206,0 186,74 0,74" fill="${tier.badgeBg}"/>
    <polygon points="26,0 35,0 15,74 6,74" fill="${tier.badgeAccent}"/>
    <polygon points="44,0 53,0 33,74 24,74" fill="${tier.badgeAccent}"/>
  </svg>`;
}

// Converts a #rrggbb hex + a 0..100 opacity into an rgba() string for the
// widget's configurable background. Falls back to the default tone on a bad hex.
function bgRgba(hex: string, opacity: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const value = m ? m[1] : '141414';
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const a = Math.max(0, Math.min(100, opacity)) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// The kapKit brand logo shown in the match-history footer — the uploaded
// assets/kapKit_logo.png, embedded via brandLogoSrc so mark + wordmark stay a
// single self-contained asset.
function brandHtml(): string {
  return `<div class="hist-brand"><img class="hist-logo" src="${brandLogoSrc}" alt="kapKit"></div>`;
}

// Tags a numeric value so the live widget can roll it to its next value with
// NumberFlow (see src/widget/animateNumbers.ts). `key` identifies the number
// across renders; `fmt` names how it's formatted (see NUMBER_FORMATS there). The
// span still holds the plain text, so the customizer preview (which doesn't
// animate) is unchanged.
function numAttrs(key: string, value: number, fmt: 'int' | 'grouped' | 'fixed2' = 'int'): string {
  return ` data-flow="${key}" data-flow-value="${value}" data-flow-fmt="${fmt}"`;
}

// Ghost values for a number slot (see numSlot): the pattern with every `#`
// filled by each digit in turn, so the slot fits the font's widest digit even in
// a font without tabular figures.
const DIGITS = '0123456789'.split('');
const ghosts = (pattern: string) => DIGITS.map((d) => pattern.replace(/#/g, d));

// The widest value each number reserves room for: a five-digit rating, a
// three-digit change, two-digit W/L counts, and per stat its widest normal
// reading (ADR and win % can reach three digits; K/D is always "0.00").
const RATING_GHOSTS = ghosts('##,###');
const DIFF_GHOSTS = ghosts('###');
const WL_GHOSTS = ghosts('##');
const STAT_GHOSTS: Record<StatKey, string[]> = {
  kd: ghosts('#.##'),
  avg: ghosts('##'),
  aim: ghosts('##'),
  winpct: ghosts('###'),
  adr: ghosts('###'),
  hs: ghosts('##'),
};

// Wraps a number in a fixed-size slot: invisible "ghost" copies of the widest
// values it should hold share its grid cell, so the slot is as wide as the
// widest of them (or the real value, if that's bigger). The number then never
// changes the widget's size or nudges what comes after it as it updates.
function numSlot(real: string, ghosts: string[], cls = 'num-slot'): string {
  return `<span class="${cls}">${ghosts.map((g) => `<span class="slot-ghost" aria-hidden="true">${g}</span>`).join('')}${real}</span>`;
}

// Builds the full widget markup for a config + data pair. Shared by the live
// widget and the customizer preview so both stay pixel-identical.
export function renderWidget(config: WidgetConfig, data: PremierData): string {
  const isFaceit = config.provider === 'faceit';
  // Challenger = a level-10 player who holds a leaderboard position (#528).
  const isChallenger = isFaceit && data.leaderboardPosition != null;
  const tier = getRankTier(data.rating);
  // Stats are averaged over the whole recent window; the history strip caps at 5
  // when stats are hidden (see historyCount below).
  const recent = data.recentGames.slice(0, config.matchCount);

  // Rating — provider-specific. Premier: the rank badge or a rank-coloured
  // number. FACEIT: the ELO, tinted with the skill-level colour — the dial art
  // already carries the level, so the number sits beside it, not on a badge.
  const ratingText = formatRating(data.rating);
  const ratingAttrs = numAttrs('rating', data.rating, 'grouped');
  let ratingHtml: string;
  // Invisible stand-ins for the widest rating the slot has to fit (see numSlot).
  // The badge is a fixed size, so it only needs its box.
  let ratingGhosts: string[];
  if (isFaceit) {
    // ELO takes the same colour as the dial: the level's tier colour, or the
    // Challenger red / #1–#3 medal colour.
    const eloColor = faceitEloColor(data.skillLevel, isChallenger, data.leaderboardPosition);
    ratingHtml = `<span class="rating-plain faceit-elo" style="color: ${eloColor}"${ratingAttrs}>${ratingText}</span>`;
    ratingGhosts = RATING_GHOSTS.map((g) => `<span class="rating-plain faceit-elo">${g}</span>`);
  } else if (config.showBadge) {
    ratingHtml = `<div class="rating-badge">${badgeSvg(tier)}<span class="rating-badge-text"${ratingAttrs}>${ratingText}</span></div>`;
    ratingGhosts = ['<div class="rating-badge"></div>'];
  } else {
    ratingHtml = `<span class="rating-plain"${ratingAttrs}>${ratingText}</span>`;
    ratingGhosts = RATING_GHOSTS.map((g) => `<span class="rating-plain">${g}</span>`);
  }

  // Rating change (rank loss/gain) — the rank-point diff (Premier) or session
  // ELO swing (FACEIT), shown with a directional arrow and the absolute value
  // (e.g. ↘ 53 / ↗ 280). Hidden when disabled or zero.
  let diffHtml = '';
  if (config.showChange && data.ratingDiff !== 0) {
    const up = data.ratingDiff > 0;
    const cls = up ? 'positive' : 'negative';
    const abs = Math.abs(data.ratingDiff);
    diffHtml = `<span class="rating-diff ${cls}">${DIFF_ARROW}<span${numAttrs('diff', abs)}>${abs}</span></span>`;
  }
  // The rating and the change each sit in a fixed slot sized for a five-digit
  // rating and a three-digit change, so the widget keeps one size as the numbers
  // roll and the change arrow stays put instead of sliding with the rating's
  // width. The change slot is there whenever the change is on, even at 0.
  const ratingSlot = numSlot(ratingHtml, ratingGhosts);
  const diffSlot = config.showChange
    ? numSlot(
        diffHtml,
        DIFF_GHOSTS.map((g) => `<span class="rating-diff positive">${DIFF_ARROW}<span>${g}</span></span>`),
        'num-slot diff-slot',
      )
    : '';

  // Left slot. Premier: the player's avatar (real Steam avatar, or the default
  // blue "smiley" mark so a missing/private avatar still shows a face). FACEIT:
  // the rank dial (the level 1–10 skill icon, or the Challenger emblem with its
  // #528 position pill), gated by the badge toggle; FACEIT shows no separate
  // avatar photo.
  let avatarHtml = '';
  if (isFaceit) {
    // The dial is always shown in FACEIT (there's no badge toggle — it's the
    // rank indicator). Challenger #1/#2/#3 recolour the emblem + position
    // number. The position pill is filled with the widget's background colour
    // at full opacity, so it still masks the emblem when the widget is
    // translucent.
    const dial = faceitDialSvg(data.skillLevel, isChallenger, data.leaderboardPosition);
    const posHtml =
      isChallenger && data.leaderboardPosition != null
        ? `<span class="faceit-pos" style="background: ${bgRgba(config.bgColor, 100)}; color: ${challengerPosColor(data.leaderboardPosition)}">#<span${numAttrs('pos', data.leaderboardPosition)}>${data.leaderboardPosition}</span></span>`
        : '';
    avatarHtml = `<div class="faceit-rank">${dial}${posHtml}</div>`;
  } else {
    const avatarSrc = data.avatarUrl ? esc(data.avatarUrl) : defaultAvatarSrc;
    avatarHtml = config.showAvatar ? `<img class="avatar" src="${avatarSrc}" alt="">` : '';
  }

  // Name, with a country flag before it in FACEIT mode — gated by the Flag
  // toggle and present only when the API returned a country (flag-icons 4:3 set;
  // radius applied in CSS).
  let nameHtml = '';
  if (config.showName) {
    const flag =
      isFaceit && config.showFlag && flagUrl(data.country)
        ? `<img class="flag" src="${flagUrl(data.country)}" alt="">`
        : '';
    nameHtml = `<div class="name">${flag}${esc(data.name)}</div>`;
  }

  // W/L record — total wins and losses across the returned recent matches.
  let wlHtml = '';
  if (config.showWinLoss) {
    wlHtml = `
    <div class="wl">
      <div class="wl-pill wl-win"><span class="wl-letter">W</span>${numSlot(`<span${numAttrs('wins', data.wins)}>${data.wins}</span>`, WL_GHOSTS, 'num-slot wl-count')}</div>
      <div class="wl-pill wl-loss"><span class="wl-letter">L</span>${numSlot(`<span${numAttrs('losses', data.losses)}>${data.losses}</span>`, WL_GHOSTS, 'num-slot wl-count')}</div>
    </div>`;
  }

  // Stats block: the user-picked subset of K/D, average kills, aim rating, and
  // win rate over the tracked matches (order follows config.stats). K/D is
  // rounded to 2 decimals (1.158 → 1.16); everything else is truncated to whole
  // numbers (18.9 → 18).
  let statsHtml = '';
  if (config.showStats && config.stats.length > 0) {
    const withKd = recent.filter((g) => g.kills != null && g.deaths != null);
    const totalKills = withKd.reduce((s, g) => s + g.kills!, 0);
    const totalDeaths = withKd.reduce((s, g) => s + g.deaths!, 0);
    // Drop the fractional part without rounding. The tiny epsilon absorbs float
    // error so e.g. 0.58 * 100 (= 57.99999999999999) still shows as 58.
    const whole = (n: number) => `${Math.trunc(n + 1e-9)}`;
    const statValues: Record<StatKey, string> = {
      kd: totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : '—',
      avg: withKd.length > 0 ? whole(totalKills / withKd.length) : '—',
      aim: whole(data.aimRating),
      // Percentages drop the "%" from the value — the "WIN %" / "HS %" label
      // below the number already carries it.
      winpct: whole((data.winRate ?? 0) * 100),
      adr: data.adr != null ? whole(data.adr) : '—',
      hs: data.hsPct != null ? whole(data.hsPct * 100) : '—',
    };
    const cells = config.stats
      .map((k) => {
        // Placeholders ("—") aren't numbers, so they just swap in statically.
        const v = statValues[k];
        const attrs = v === '—' ? '' : numAttrs(`stat-${k}`, Number(v), k === 'kd' ? 'fixed2' : 'int');
        const val = numSlot(`<span${attrs}>${v}</span>`, STAT_GHOSTS[k], 'num-slot stat-val');
        return `<div class="stat stat-${k}">${val}<span class="stat-lbl">${STAT_LABELS[k]}</span></div>`;
      })
      .join('');
    statsHtml = `<div class="stats">${cells}</div>`;
  }

  // Match-history strip: W/L/T letters most-recent → oldest, left to right.
  // recentGames is newest-first (both providers), so no reversal. When stats are
  // hidden the widget is narrower, so the strip is capped at 5; with stats on it
  // shows up to matchCount. FACEIT's ELO mode swaps the letters for outlined
  // chips carrying each match's ELO change (+23 / -12, Figma 157:3546); a match
  // without an ELO change keeps its letter inside the chip.
  // The ELO chips are much wider than letters, so that mode always caps at 5.
  const eloMode = isFaceit && config.historyMode === 'elo';
  const noStatsWithHistory = !config.showStats && config.showMatchHistory;
  const historyCount = noStatsWithHistory || eloMode ? Math.min(5, config.matchCount) : config.matchCount;
  let historyHtml = '';
  if (config.showMatchHistory) {
    const letters = data.recentGames
      .slice(0, historyCount)
      .map((g) => {
        const cls = g.outcome === 'win' ? 'w' : g.outcome === 'tie' ? 't' : 'l';
        const lbl = g.outcome === 'win' ? 'W' : g.outcome === 'tie' ? 'T' : 'L';
        // The match id lets the live widget slide a new match in on the left
        // (see animateHistory in animateNumbers.ts).
        const idAttr = g.id ? ` data-hist-id="${esc(g.id)}"` : '';
        if (!eloMode) return `<span class="${cls}"${idAttr}>${lbl}</span>`;
        const d = g.eloChange;
        const text = d == null ? lbl : d > 0 ? `+${d}` : d < 0 ? `-${Math.abs(d)}` : '0';
        return `<span class="hist-chip ${cls}"${idAttr}>${text}</span>`;
      })
      .join('');
    historyHtml = `
      <div class="widget-history">
        <div class="hist-letters${eloMode ? ' hist-elo' : ''}">${letters}</div>
        ${brandHtml()}
      </div>`;
  }

  const modifiers = [
    // Provider drives the rating colour: Premier by rank tier, FACEIT by level.
    isFaceit ? 'provider-faceit' : `rank-${tier.key}`,
    config.showBadge ? 'has-badge' : 'no-badge',
    // has-avatar controls left-slot spacing; in FACEIT the slot is always the dial.
    (isFaceit || config.showAvatar) ? 'has-avatar' : 'no-avatar',
    isChallenger ? 'is-challenger' : '',
    // 100 is the fully rounded pill preset.
    config.cornerRadius === 100 ? 'radius-full' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Design overrides: configurable background tint/opacity, font family, and
  // weight. `--w-weight` drives the body/name text and the plain rating / FACEIT
  // ELO; `--w-weight-strong` is one step heavier for the rating diff.
  // `--w-radius` is the corner radius; the 100 preset is a full pill, so it's
  // capped by the widget's height.
  const weight = Math.max(100, Math.min(900, config.fontWeight || 700));
  const weightStrong = Math.min(900, weight + 100);
  const rootStyle = `background: ${bgRgba(config.bgColor, config.bgOpacity)}; font-family: ${fontStack(
    config.font,
  )}; --w-weight: ${weight}; --w-weight-strong: ${weightStrong}; --w-radius: ${
    config.cornerRadius === 100 ? 9999 : config.cornerRadius
  }px;`;

  return `
    <div class="widget ${modifiers}" style="${rootStyle}">
      <div class="widget-main">
        <div class="identity">
          ${avatarHtml}
          <div class="identity-text">
            ${nameHtml}
            <div class="rating-line">
              ${ratingSlot}
              ${diffSlot}
            </div>
          </div>
        </div>
        ${statsHtml}
        ${wlHtml}
      </div>
      ${historyHtml}
    </div>`;
}

// Simple single-line state (loading / error / prompt) styled like the widget.
export function renderMessage(title: string, value: string): string {
  return `
    <div class="widget rank-gray no-badge no-avatar">
      <div class="widget-main">
        <div class="identity">
          <div class="identity-text">
            <div class="name">${esc(title)}</div>
            <div class="rating-line"><span class="rating-plain">${esc(value)}</span></div>
          </div>
        </div>
      </div>
    </div>`;
}
