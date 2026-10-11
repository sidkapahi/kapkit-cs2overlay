// FACEIT rank cycle. After each stats refresh the name slot steps through the
// player's leaderboard positions: the flag turns into the region icon and the
// name shows the regional rank, then the country flag comes back with the
// country rank, then the name returns. render.ts draws every layer (see
// .has-rank-cycle in widget.css); this only moves `data-step` along. A step the
// card has no layer for (FACEIT doesn't rank the player there) is skipped.

type Step = 'name' | 'region' | 'country';

// How long each rank stays up.
const HOLD_MS = 5000;
// Just past the longest transition in widget.css.
const LEAVE_MS = 900;

export function createRankCycle(container: HTMLElement) {
  let step: Step = 'name';
  let running = false;

  const nameEl = () => container.querySelector<HTMLElement>('.has-rank-cycle');
  const layer = (el: HTMLElement, s: Step) => el.querySelector<HTMLElement>(`.layer-${s}`);
  const flagFor = (el: HTMLElement, s: Step) =>
    el.querySelector<HTMLElement>(s === 'region' ? '.flag-region' : '.flag-country');

  function show(next: Step) {
    const el = nameEl();
    const prev = step;
    step = next;
    if (!el || prev === next) return;
    // The outgoing text and flag leave the opposite way to the incoming ones,
    // then (out of sight) drop back to where the next entrance starts.
    const leaving = [layer(el, prev), flagFor(el, prev) !== flagFor(el, next) ? flagFor(el, prev) : null];
    for (const n of leaving) n?.classList.add('is-leaving');
    el.dataset.step = next;
    setTimeout(() => {
      for (const n of leaving) n?.classList.remove('is-leaving');
    }, LEAVE_MS);
  }

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  return {
    // After a re-render: put the fresh markup on the current step without
    // replaying the transition.
    restore() {
      const el = nameEl();
      if (!el || step === 'name') return;
      el.classList.add('cycle-instant');
      el.dataset.step = step;
      void el.offsetWidth;
      el.classList.remove('cycle-instant');
    },
    // Plays the cycle once, after `delayMs`. A refresh that lands mid-cycle
    // doesn't restart it.
    async play(delayMs = 0) {
      if (running) return;
      running = true;
      try {
        await wait(delayMs);
        for (const s of ['region', 'country'] as const) {
          const el = nameEl();
          if (!el || !layer(el, s)) continue;
          show(s);
          await wait(HOLD_MS);
        }
        show('name');
      } finally {
        running = false;
      }
    },
  };
}
