// FACEIT rank cycle. After each stats refresh the name slot steps through the
// player's leaderboard positions: the flag turns into the region icon and the
// name rolls over to the regional rank, then the country flag comes back as the
// rank ticks over to the country rank, then the name returns. render.ts draws
// the layers (see .has-rank-cycle in widget.css); this moves `data-step` (the
// text) and `data-flag` (which flag shows) along. A step FACEIT doesn't rank
// the player in is skipped.
import NumberFlow from 'number-flow';
import { FADE_TIMING, ROLL_TIMING, reducedMotion } from './animateNumbers';

type Step = 'name' | 'region' | 'country';
type Flag = 'country' | 'region';

// How long each rank stays fully up, once it has rolled in.
const HOLD_MS = 5000;
// The roll in widget.css (.name-layer, .flag-stack > .flag).
const ROLL_MS = 1875;
// Just past it.
const LEAVE_MS = 2000;

const RANK_FORMAT = { useGrouping: true, maximumFractionDigits: 0 };
const formatRank = (n: number) => n.toLocaleString('en-US', RANK_FORMAT);

export function createRankCycle(container: HTMLElement) {
  let step: Step = 'name';
  let flag: Flag = 'country';
  let running = false;

  const nameEl = () => container.querySelector<HTMLElement>('.has-rank-cycle');
  const rankFor = (el: HTMLElement, s: Step) => {
    const v = el.querySelector<HTMLElement>('.rank-num')?.dataset[s === 'region' ? 'regionRank' : 'countryRank'];
    return v ? Number(v) : null;
  };
  const flagEl = (el: HTMLElement, f: Flag) => el.querySelector<HTMLElement>(`.flag-${f}`);
  const leave = (nodes: (HTMLElement | null)[]) => {
    for (const n of nodes) n?.classList.add('is-leaving');
    setTimeout(() => {
      for (const n of nodes) n?.classList.remove('is-leaving');
    }, LEAVE_MS);
  };

  // Shows `value` in the rank slot: ticked over digit by digit with NumberFlow
  // when the rank is already up, set straight away when it's rolling in.
  function setRank(el: HTMLElement, value: number, tick: boolean) {
    const slot = el.querySelector<HTMLElement>('.rank-num');
    if (!slot) return;
    if (!tick || reducedMotion()) {
      slot.textContent = formatRank(value);
      return;
    }
    let flow = slot.querySelector<NumberFlow>('number-flow');
    if (!flow) {
      flow = document.createElement('number-flow') as NumberFlow;
      flow.locales = 'en-US';
      flow.format = RANK_FORMAT;
      flow.transformTiming = ROLL_TIMING;
      flow.opacityTiming = FADE_TIMING;
      flow.update(Number(slot.textContent!.replace(/\D/g, '')));
      slot.replaceChildren(flow);
    }
    const f = flow;
    requestAnimationFrame(() => f.update(value));
  }

  function setFlag(el: HTMLElement, next: Flag, instant: boolean) {
    const prev = flag;
    flag = next;
    if (prev === next || !flagEl(el, next)) return;
    if (instant) {
      el.classList.add('flag-instant');
      el.dataset.flag = next;
      void el.offsetWidth;
      el.classList.remove('flag-instant');
      return;
    }
    leave([flagEl(el, prev)]);
    el.dataset.flag = next;
  }

  function show(next: Step) {
    const el = nameEl();
    const prev = step;
    step = next;
    if (!el || prev === next) return;
    // With the flag off the flag drops in with the rank and away again with
    // the name (widget.css), so it only rolls between the two rank steps.
    const inline = el.classList.contains('rank-flags-inline');
    if (next !== 'name') {
      setRank(el, rankFor(el, next)!, prev !== 'name');
      setFlag(el, next, inline && prev === 'name');
    } else if (inline) {
      leave([el.querySelector<HTMLElement>('.flag-reveal > .flag-stack')]);
    } else {
      setFlag(el, 'country', false);
    }
    if ((prev === 'name') !== (next === 'name')) {
      leave([el.querySelector<HTMLElement>(prev === 'name' ? '.layer-name' : '.layer-rank')]);
    }
    el.dataset.step = next;
  }

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  return {
    // After a re-render: put the fresh markup on the current step without
    // replaying the transition.
    restore() {
      const el = nameEl();
      if (!el || (step === 'name' && flag === 'country')) return;
      el.classList.add('cycle-instant');
      el.dataset.step = step;
      el.dataset.flag = flag;
      if (step !== 'name' && rankFor(el, step) != null) setRank(el, rankFor(el, step)!, false);
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
          if (!el || rankFor(el, s) == null) continue;
          show(s);
          await wait(ROLL_MS + HOLD_MS);
        }
        show('name');
      } finally {
        running = false;
      }
    },
  };
}
