import type { PremierData } from './api';
import { brandLogoSrc } from './brandLogo';
import { defaultAvatarSrc } from './defaultAvatar';
import { challengerColor, faceitDialSvg, faceitEloColor } from './faceitRanks';
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

// Directional arrows for the rating change (rank loss/gain). Recreated inline
// from the Figma "ArrowUpRight" / "ArrowDownRight" icons so the exported widget
// stays self-contained (no external asset). `currentColor` inherits the diff's
// positive/negative tint. The viewBox is the full 48×48 design frame, so the
// arrow keeps the padding that sits it inset in its box (icon ≈ 1.2× the number,
// per .diff-arrow) and carries its built-in gap to the number — matching Figma
// 70:1419 / 70:1413. To swap in a custom mark, replace the paths here.
const DIFF_ARROW_UP = `<svg class="diff-arrow" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 36L36 12" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.5 12H36V31.5" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const DIFF_ARROW_DOWN = `<svg class="diff-arrow" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 12L36 36" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.5 36H36V16.5" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

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
  let ratingHtml: string;
  if (isFaceit) {
    // ELO takes the same colour as the dial: the level's tier colour, or the
    // Challenger red / #1–#3 medal colour.
    const eloColor = faceitEloColor(data.skillLevel, isChallenger, data.leaderboardPosition);
    ratingHtml = `<span class="rating-plain faceit-elo" style="color: ${eloColor}">${ratingText}</span>`;
  } else {
    ratingHtml = config.showBadge
      ? `<div class="rating-badge">${badgeSvg(tier)}<span class="rating-badge-text">${ratingText}</span></div>`
      : `<span class="rating-plain">${ratingText}</span>`;
  }

  // Rating change (rank loss/gain) — the rank-point diff (Premier) or session
  // ELO swing (FACEIT), shown with a directional arrow and the absolute value
  // (e.g. ↘ 53 / ↗ 280). Hidden when disabled or zero.
  let diffHtml = '';
  if (config.showChange && data.ratingDiff !== 0) {
    const up = data.ratingDiff > 0;
    const cls = up ? 'positive' : 'negative';
    const arrow = up ? DIFF_ARROW_UP : DIFF_ARROW_DOWN;
    diffHtml = `<span class="rating-diff ${cls}">${arrow}${Math.abs(data.ratingDiff)}</span>`;
  }

  // Left slot. Premier: the player's avatar (real Steam avatar, or the default
  // blue "smiley" mark so a missing/private avatar still shows a face). FACEIT:
  // the rank dial (the level 1–10 skill icon, or the Challenger emblem with its
  // #528 position pill), gated by the badge toggle; FACEIT shows no separate
  // avatar photo.
  let avatarHtml = '';
  if (isFaceit) {
    // The dial is always shown in FACEIT (there's no badge toggle — it's the
    // rank indicator). Challenger #1/#2/#3 recolour the emblem + pill.
    const dial = faceitDialSvg(data.skillLevel, isChallenger, data.leaderboardPosition);
    const posHtml =
      isChallenger && data.leaderboardPosition != null
        ? `<span class="faceit-pos" style="background: ${challengerColor(data.leaderboardPosition)}">#${data.leaderboardPosition}</span>`
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

  // W/L pills — total wins and losses across the returned recent matches.
  let wlHtml = '';
  if (config.showWinLoss) {
    wlHtml = `
    <div class="wl">
      <div class="wl-pill wl-win">${data.wins}W</div>
      <div class="wl-pill wl-loss">${data.losses}L</div>
    </div>`;
  }

  // Stats block: the user-picked subset of K/D, average kills, aim rating, and
  // win rate over the tracked matches (order follows config.stats). K/D is
  // truncated to 2 decimals (1.158 → 1.15); everything else to whole numbers
  // (18.9 → 18).
  let statsHtml = '';
  if (config.showStats && config.stats.length > 0) {
    const withKd = recent.filter((g) => g.kills != null && g.deaths != null);
    const totalKills = withKd.reduce((s, g) => s + g.kills!, 0);
    const totalDeaths = withKd.reduce((s, g) => s + g.deaths!, 0);
    // Drop the fractional part without rounding. The tiny epsilon absorbs float
    // error so e.g. 0.58 * 100 (= 57.99999999999999) still shows as 58.
    const whole = (n: number) => `${Math.trunc(n + 1e-9)}`;
    const statValues: Record<StatKey, string> = {
      kd: totalDeaths > 0 ? (Math.trunc((totalKills / totalDeaths) * 100 + 1e-9) / 100).toFixed(2) : '—',
      avg: withKd.length > 0 ? whole(totalKills / withKd.length) : '—',
      aim: whole(data.aimRating),
      // Percentages drop the "%" from the value — the "WIN %" / "HS %" label
      // below the number already carries it.
      winpct: whole((data.winRate ?? 0) * 100),
      adr: data.adr != null ? whole(data.adr) : '—',
      hs: data.hsPct != null ? whole(data.hsPct * 100) : '—',
    };
    const cells = config.stats
      .map(
        (k) =>
          `<div class="stat"><span class="stat-val">${statValues[k]}</span><span class="stat-lbl">${STAT_LABELS[k]}</span></div>`,
      )
      .join('');
    statsHtml = `<div class="stats">${cells}</div>`;
  }

  // Match-history strip: W/L/T letters most-recent → oldest, left to right.
  // recentGames is newest-first (both providers), so no reversal. When stats are
  // hidden the widget is narrower, so the strip is capped at 5; with stats on it
  // shows up to matchCount.
  const noStatsWithHistory = !config.showStats && config.showMatchHistory;
  const historyCount = noStatsWithHistory ? Math.min(5, config.matchCount) : config.matchCount;
  let historyHtml = '';
  if (config.showMatchHistory) {
    const letters = data.recentGames
      .slice(0, historyCount)
      .map((g) => {
        const cls = g.outcome === 'win' ? 'w' : g.outcome === 'tie' ? 't' : 'l';
        const lbl = g.outcome === 'win' ? 'W' : g.outcome === 'tie' ? 'T' : 'L';
        return `<span class="${cls}">${lbl}</span>`;
      })
      .join('');
    historyHtml = `
      <div class="widget-history">
        <div class="hist-letters">${letters}</div>
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
  ]
    .filter(Boolean)
    .join(' ');

  // Design overrides: configurable background tint/opacity, font family, and
  // weight. `--w-weight` drives the body/name text; `--w-weight-strong` is one
  // step heavier for the rating diff. (The plain rating / FACEIT ELO is pinned
  // to 800 in CSS and doesn't follow either.)
  const weight = Math.max(100, Math.min(900, config.fontWeight || 700));
  const weightStrong = Math.min(900, weight + 100);
  const rootStyle = `background: ${bgRgba(config.bgColor, config.bgOpacity)}; font-family: ${fontStack(
    config.font,
  )}; --w-weight: ${weight}; --w-weight-strong: ${weightStrong};`;

  return `
    <div class="widget ${modifiers}" style="${rootStyle}">
      <div class="widget-main">
        <div class="identity">
          ${avatarHtml}
          <div class="identity-text">
            ${nameHtml}
            <div class="rating-line">
              ${ratingHtml}
              ${diffHtml}
            </div>
          </div>
        </div>
        ${wlHtml}
        ${statsHtml}
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
