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

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
// back), and spins the arrow in when the change first appears.
export function createNumberAnimator() {
  const previous = new Map<string, number>();
  let prevArrowDeg: number | undefined;
  let prevDiffColor = '';

  function animateDiff(root: HTMLElement) {
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
    if (!arrow || fromDeg === deg || reducedMotion()) return;

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

  return function animateNumbers(root: HTMLElement) {
    root.querySelectorAll<HTMLElement>('[data-flow]').forEach((el) => {
      const key = el.dataset.flow!;
      const value = Number(el.dataset.flowValue);
      if (!Number.isFinite(value)) return;
      const prev = previous.get(key) ?? 0;
      previous.set(key, value);
      if (prev === value) return;

      const flow = document.createElement('number-flow') as NumberFlow;
      flow.locales = 'en-US';
      flow.format = NUMBER_FORMATS[el.dataset.flowFmt ?? 'int'] ?? NUMBER_FORMATS.int;
      // Start on the old value (rendered without animation on connect), then
      // update to the new one on the next frame so NumberFlow rolls the digits.
      flow.update(prev);
      el.replaceChildren(flow);
      requestAnimationFrame(() => flow.update(value));
    });
    animateDiff(root);
  };
}
