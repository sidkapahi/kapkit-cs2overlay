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

// Remembers the last value shown for each tagged number (by `data-flow` key) and,
// after every re-render, rolls the ones that changed from their old value to the
// new one with NumberFlow. The first time a key is seen it just shows statically.
export function createNumberAnimator() {
  const previous = new Map<string, number>();

  return function animateNumbers(root: HTMLElement) {
    root.querySelectorAll<HTMLElement>('[data-flow]').forEach((el) => {
      const key = el.dataset.flow!;
      const value = Number(el.dataset.flowValue);
      if (!Number.isFinite(value)) return;
      const prev = previous.get(key);
      previous.set(key, value);
      if (prev === undefined || prev === value) return;

      const flow = document.createElement('number-flow') as NumberFlow;
      flow.locales = 'en-US';
      flow.format = NUMBER_FORMATS[el.dataset.flowFmt ?? 'int'] ?? NUMBER_FORMATS.int;
      // Start on the old value (rendered without animation on connect), then
      // update to the new one on the next frame so NumberFlow rolls the digits.
      flow.update(prev);
      el.replaceChildren(flow);
      requestAnimationFrame(() => flow.update(value));
    });
  };
}
