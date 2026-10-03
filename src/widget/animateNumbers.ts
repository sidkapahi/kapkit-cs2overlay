import 'number-flow';
import type NumberFlow from 'number-flow';
import type { Format } from 'number-flow';

// Intl formats matching the plain text render.ts writes for each `data-flow-fmt`,
// so a number looks the same before, during and after its roll.
const NUMBER_FORMATS: Record<string, Format> = {
  // Whole numbers (stats, W/L counts, diff, leaderboard position) — no grouping,
  // matching the raw `${n}` text.
  int: { useGrouping: false, maximumFractionDigits: 0 },
  // The rating, formatted like formatRating() (en-US thousands separators).
  grouped: { useGrouping: true, maximumFractionDigits: 0 },
  // K/D, always two decimals.
  fixed2: { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 },
};

// How long the first-load entrance (.intro in widget.css) runs, with headroom
// for the longest delay + duration there.
const INTRO_MS = 1500;

// Springy ease (slight overshoot) for the rating-change arrow.
const ARROW_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Plays the first-load entrance on everything that isn't a rolling number
// (avatar, name, labels, W/L letters, history strip) by tagging the container
// with .intro for the length of the animation.
export function playIntro(root: HTMLElement) {
  root.classList.add('intro');
  setTimeout(() => root.classList.remove('intro'), INTRO_MS);
}

// Remembers the last value shown for each tagged number (by `data-flow` key) and,
// after every re-render, rolls the ones that changed from their old value to the
// new one with NumberFlow. The first time a key is seen (the overlay's first
// load, or a number that just appeared) it rolls up from zero. It also swings
// the rating-change arrow and fades its colour when a gain flips to a loss (or
// back), spins the arrow in when the change first appears, and slides new
// matches into the history strip.
//
// With `animate` false it only records what's on screen as the starting point,
// so the next render rolls from those values instead of from zero (used when the
// page reloads itself onto a new build, see autoReload.ts).
export function createNumberAnimator() {
  const previous = new Map<string, number>();
  let prevArrowDeg: number | undefined;
  let prevDiffColor = '';

  function animateDiff(root: HTMLElement, animate: boolean) {
    // Skip the invisible size placeholders (.slot-ghost, see numSlot in render.ts).
    const diff = [...root.querySelectorAll<HTMLElement>('.rating-diff')].find(
      (el) => !el.closest('.slot-ghost'),
    );
    if (!diff) {
      // Hidden (no change, or turned off): the next one spins in fresh.
      prevArrowDeg = undefined;
      return;
    }
    const arrow = diff.querySelector<SVGElement>('.diff-arrow');
    // Matches .rating-diff.negative .diff-arrow in widget.css.
    const deg = diff.classList.contains('negative') ? 90 : 0;
    const color = getComputedStyle(diff).color;
    const fromDeg = prevArrowDeg;
    const fromColor = prevDiffColor;
    prevArrowDeg = deg;
    prevDiffColor = color;
    if (!animate || !arrow || fromDeg === deg || reducedMotion()) return;

    if (fromDeg === undefined) {
      // First appearance: start pointing right and swing up (gain) or down (loss).
      arrow.animate(
        [
          { transform: 'rotate(45deg) scale(0.4)', opacity: 0 },
          { transform: `rotate(${deg}deg) scale(1)`, opacity: 1 },
        ],
        { duration: 700, easing: ARROW_EASING, delay: 150, fill: 'backwards' },
      );
      return;
    }
    // Gain ↔ loss: turn the arrow from its old direction and fade the tint.
    arrow.animate(
      [{ transform: `rotate(${fromDeg}deg)` }, { transform: `rotate(${deg}deg)` }],
      { duration: 700, easing: ARROW_EASING },
    );
    diff.animate([{ color: fromColor }, { color }], { duration: 500, easing: 'ease-out' });
  }

  // Match history (newest on the left): when new matches come in, they slide in
  // from the left, the rest of the strip shifts right to make room, and the
  // matches pushed off the end slide out to the right and fade.
  let prevHistory: { id: string; html: string }[] | null = null;

  function animateHistory(root: HTMLElement, animate: boolean) {
    const strip = root.querySelector<HTMLElement>('.hist-letters');
    const items = strip ? [...strip.querySelectorAll<HTMLElement>(':scope > [data-hist-id]')] : [];
    const before = prevHistory;
    // Only items that all carry a match id can be lined up across renders.
    prevHistory =
      strip && items.length === strip.children.length
        ? items.map((el) => ({ id: el.dataset.histId!, html: el.outerHTML }))
        : null;
    if (!animate || !before || !prevHistory || items.length < 2 || reducedMotion()) return;

    // How many new matches were added at the front: the old newest match now
    // sits that many slots further right.
    const shift = prevHistory.findIndex((m) => m.id === before[0].id);
    if (shift <= 0) return;

    // Every slot is the same width (letters share one width, ELO chips are
    // fixed), so one step is the distance between neighbours.
    const step = items[1].offsetLeft - items[0].offsetLeft;
    const timing = { duration: 600, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
    items.forEach((el, i) => {
      const from = `translateX(${-shift * step}px)`;
      const frames =
        i < shift
          ? [{ transform: from, opacity: 0 }, { transform: 'none', opacity: 1 }]
          : [{ transform: from }, { transform: 'none' }];
      el.animate(frames, { ...timing, delay: i < shift ? 80 : 0, fill: 'backwards' });
    });

    // The matches that fell off the end aren't in the new markup: put a copy of
    // each back where it was and slide it out to the right as it fades.
    const kept = before.length - shift;
    before.slice(Math.max(0, kept)).forEach((m, k) => {
      const tmp = document.createElement('div');
      tmp.innerHTML = m.html;
      const ghost = tmp.firstElementChild as HTMLElement;
      ghost.removeAttribute('data-hist-id');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.position = 'absolute';
      ghost.style.left = `${items[0].offsetLeft + (kept + k) * step}px`;
      ghost.style.top = `${items[0].offsetTop}px`;
      strip!.appendChild(ghost);
      ghost
        .animate(
          [
            { transform: 'none', opacity: 1 },
            { transform: `translateX(${shift * step}px)`, opacity: 0 },
          ],
          timing,
        )
        .finished.then(
          () => ghost.remove(),
          () => ghost.remove(),
        );
    });
  }

  return function animateNumbers(root: HTMLElement, animate = true) {
    const seen = new Set<string>();
    root.querySelectorAll<HTMLElement>('[data-flow]').forEach((el) => {
      const key = el.dataset.flow!;
      seen.add(key);
      const value = Number(el.dataset.flowValue);
      if (!Number.isFinite(value)) return;
      const prev = previous.get(key) ?? 0;
      previous.set(key, value);
      if (!animate || prev === value) return;

      const flow = document.createElement('number-flow') as NumberFlow;
      flow.locales = 'en-US';
      flow.format = NUMBER_FORMATS[el.dataset.flowFmt ?? 'int'] ?? NUMBER_FORMATS.int;
      // Start on the old value (rendered without animation on connect), then
      // update to the new one on the next frame so NumberFlow rolls the digits.
      flow.update(prev);
      el.replaceChildren(flow);
      requestAnimationFrame(() => flow.update(value));
    });
    // Forget numbers that are no longer shown (a stat or the change turned
    // off), so they roll up from zero again when they come back.
    for (const key of previous.keys()) if (!seen.has(key)) previous.delete(key);
    animateDiff(root, animate);
    animateHistory(root, animate);
  };
}
