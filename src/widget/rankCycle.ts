// FACEIT rank cycle. After each stats refresh the name slot steps through the
// player's leaderboard positions: the flag turns into the region icon and the
// name rolls over to the regional rank, then the country flag comes back and
// the rank ticks over to the country rank, then the name returns. render.ts
// draws the layers (see .has-rank-cycle in widget.css); this sets the data
// attributes that drive them, one move at a time (Sid: the text never changes
// while the flag is still moving):
//   data-step     which text shows (name, or the rank)
//   data-flag     which flag shows (country or region)
//   data-gap      flag off only: the gap for the flag is open
//   data-flag-in  flag off only: the flag has dropped into the gap
// A step FACEIT doesn't rank the player in is skipped.
import NumberFlow from 'number-flow';
import { FADE_TIMING, ROLL_TIMING, reducedMotion } from './animateNumbers';

type Step = 'name' | 'region' | 'country';
type Flag = 'country' | 'region';

// How long each rank stays fully up, once it has rolled in.
const HOLD_MS = 5000;
// The text roll (.name-layer in widget.css), and NumberFlow's tick.
const ROLL_MS = 1875;
const TICK_MS = ROLL_TIMING.duration;
// The gap opening / closing and the flag dropping (.flag-reveal).
const MOVE_MS = 1500;
// Just past the longest of them, for clearing .is-leaving.
const LEAVE_MS = 2000;

const RANK_FORMAT = { useGrouping: true, maximumFractionDigits: 0 };
const formatRank = (n: number) => n.toLocaleString('en-US', RANK_FORMAT);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createRankCycle(container: HTMLElement) {
  let step: Step = 'name';
  let flag: Flag = 'country';
  let gap = false;
  let flagIn = false;
  let running = false;

  const nameEl = () => container.querySelector<HTMLElement>('.has-rank-cycle');
  const rankFor = (el: HTMLElement, s: Step) => {
    const v = el.querySelector<HTMLElement>('.rank-num')?.dataset[s === 'region' ? 'regionRank' : 'countryRank'];
    return v ? Number(v) : null;
  };
  const leave = (node: HTMLElement | null | undefined) => {
    node?.classList.add('is-leaving');
    setTimeout(() => node?.classList.remove('is-leaving'), LEAVE_MS);
  };
  const toggle = (el: HTMLElement, attr: string, on: boolean) => {
    if (on) el.setAttribute(attr, '');
    else el.removeAttribute(attr);
  };

  // Puts every attribute on the current state with no transition (after a
  // re-render, or for a change nobody can see).
  function apply(el: HTMLElement, instant: boolean) {
    if (instant) el.classList.add('cycle-instant');
    el.dataset.step = step;
    el.dataset.flag = flag;
    toggle(el, 'data-gap', gap);
    toggle(el, 'data-flag-in', flagIn);
    if (step !== 'name' && rankFor(el, step) != null) setRankText(el, rankFor(el, step)!);
    if (instant) {
      void el.offsetWidth;
      el.classList.remove('cycle-instant');
    }
  }

  function setRankText(el: HTMLElement, value: number) {
    const slot = el.querySelector<HTMLElement>('.rank-num');
    if (slot) slot.textContent = formatRank(value);
  }

  // Ticks the rank that's already up over to `value`, digit by digit.
  function tickRank(el: HTMLElement, value: number) {
    const slot = el.querySelector<HTMLElement>('.rank-num');
    if (!slot) return;
    if (reducedMotion()) return setRankText(el, value);
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

  // Rolls the flag over to `next` (the old one goes up, the new one comes up
  // from below). Resolves once it has landed; at once if there's nothing to do.
  async function rollFlag(el: HTMLElement, next: Flag) {
    if (flag === next || !el.querySelector(`.flag-${next}`)) return;
    leave(el.querySelector<HTMLElement>(`.flag-${flag}`));
    flag = next;
    el.dataset.flag = next;
    await wait(MOVE_MS);
  }

  // The text rolls between the name and the rank.
  async function rollText(el: HTMLElement, next: Step) {
    leave(el.querySelector<HTMLElement>(next === 'name' ? '.layer-rank' : '.layer-name'));
    if (next !== 'name') setRankText(el, rankFor(el, next)!);
    step = next;
    el.dataset.step = next;
    await wait(ROLL_MS);
  }

  async function show(next: Step) {
    const el = nameEl();
    if (!el || step === next) return;
    const inline = el.classList.contains('rank-flags-inline');
    const nextFlag: Flag = next === 'region' ? 'region' : 'country';

    if (step === 'name') {
      // Coming in.
      if (inline) {
        // The flag is out of sight: put the right one in place, open the gap
        // (the text slides right), drop the flag in, then roll the text.
        flag = nextFlag;
        apply(el, true);
        gap = true;
        el.setAttribute('data-gap', '');
        await wait(MOVE_MS);
        flagIn = true;
        el.setAttribute('data-flag-in', '');
        await wait(MOVE_MS);
      } else {
        await rollFlag(el, nextFlag);
      }
      await rollText(el, next);
    } else if (next !== 'name') {
      // Region → country: the flag rolls over, then the rank ticks.
      await rollFlag(el, nextFlag);
      step = next;
      el.dataset.step = next;
      tickRank(el, rankFor(el, next)!);
      await wait(TICK_MS);
    } else {
      // Going out: the reverse.
      await rollText(el, 'name');
      if (inline) {
        leave(el.querySelector<HTMLElement>('.flag-reveal > .flag-stack'));
        flagIn = false;
        el.removeAttribute('data-flag-in');
        await wait(MOVE_MS);
        gap = false;
        el.removeAttribute('data-gap');
        await wait(MOVE_MS);
      } else {
        await rollFlag(el, 'country');
      }
    }
  }

  return {
    // After a re-render: put the fresh markup on the current state without
    // replaying anything.
    restore() {
      const el = nameEl();
      if (el) apply(el, true);
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
          await show(s);
          await wait(HOLD_MS);
        }
        await show('name');
      } finally {
        running = false;
      }
    },
  };
}
