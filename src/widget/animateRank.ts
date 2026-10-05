import { reducedMotion } from './animateNumbers';

// FACEIT level-change animation. When a re-render shows a different level than
// the last one, the dial's coloured arc sweeps forward to the new level (or
// drains back to it on a level down), the level number rolls out and the new
// one rolls in, then the dial pops with a ring in the new tier colour (level
// up) or gives a small shake (level down). Reaching or leaving Challenger swaps
// the emblem with a spin-in / drop-out instead, since its art has no arc.
//
// The dial art is baked SVG (assets/faceit/), so the animation runs on copies
// of the old and new dials layered over the real one, which stays hidden (but
// still holds its space) until they finish. Nothing here changes layout.

// Where the coloured arc starts (its lower-left end), in degrees clockwise from
// 12 o'clock, and how far round it reaches at each level 1–10, measured from
// the inner corner of each dial's arc end in assets/faceit/level-*.svg. The
// steps aren't even: FACEIT's dials fill the arc unevenly.
const ARC_START = 220.6;
const ARC_END = [0, 17.4, 28.8, 49.4, 94.4, 139.4, 171.4, 194.9, 229.4, 254.6, 278.8];

// data-rank (render.ts) uses 11 for Challenger.
const CHALLENGER = 11;

const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// Total length of the longest sequence below, after which the copies are removed.
const RANK_MS = 2505;

interface RankState {
  rank: number;
  color: string;
  svg: string;
  pos: string;
}

type Part = 'dial' | 'num' | 'all';

// A copy of a dial as an absolutely positioned layer. 'dial' drops the level
// number (the last path of a level dial), 'num' keeps only the number, inside a
// circular window so it can roll in and out of the dial's centre.
function layer(svgHtml: string, part: Part): HTMLElement {
  const div = document.createElement('div');
  div.className = 'rank-fx-layer';
  div.innerHTML = svgHtml;
  const svg = div.querySelector('svg');
  if (svg && part !== 'all') {
    const num = [...svg.querySelectorAll('path')].pop();
    if (part === 'dial') num?.remove();
    else {
      [...svg.children].forEach((c) => c !== num && c.remove());
      div.classList.add('rank-fx-num');
    }
  }
  return div;
}

// Drives a conic mask on `el` so only the arc from its start to `deg` shows.
function setSweep(el: HTMLElement, deg: number) {
  const mask = `conic-gradient(from ${ARC_START}deg, #000 ${deg}deg, transparent ${deg + 0.8}deg)`;
  el.style.setProperty('-webkit-mask-image', mask);
  el.style.setProperty('mask-image', mask);
}

function sweep(el: HTMLElement, from: number, to: number, delay: number, duration: number) {
  setSweep(el, from);
  const start = performance.now() + delay;
  const tick = (now: number) => {
    const p = Math.min(1, Math.max(0, (now - start) / duration));
    setSweep(el, from + (to - from) * easeInOut(p));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// The number layer's svg rolls through its circular window.
function rollNumber(el: HTMLElement, dir: 1 | -1, out: boolean, delay: number) {
  const off = { transform: `translateY(${dir * (out ? -45 : 45)}%) scale(0.7)`, opacity: 0 };
  const on = { transform: 'none', opacity: 1 };
  el.firstElementChild?.animate(out ? [on, off] : [off, on], {
    duration: out ? 468 : 752,
    delay,
    easing: out ? 'cubic-bezier(0.5, 0, 0.75, 0)' : SPRING,
    fill: out ? 'forwards' : 'backwards',
  });
}

function playRankChange(rankEl: HTMLElement, svg: SVGElement, from: RankState, to: RankState) {
  const up = to.rank > from.rank;
  const fx = document.createElement('div');
  fx.className = 'rank-fx';
  fx.setAttribute('aria-hidden', 'true');
  // The dial is the rank slot's only in-flow child, so it fills its width.
  fx.style.height = `${svg.clientHeight}px`;
  // Before the position pill, so the pill still sits on top.
  svg.after(fx);
  svg.style.visibility = 'hidden';

  if (from.rank !== CHALLENGER && to.rank !== CHALLENGER) {
    // Level ↔ level: the arc sweeps between the two levels. When the tier
    // colour changes (5 → 8, say), the sweep starts from the arc's beginning so
    // the whole arc takes on the new colour; otherwise it only covers the gap.
    const sameColor = from.color === to.color;
    const under = layer(up ? from.svg : to.svg, 'dial');
    const over = layer(up ? to.svg : from.svg, 'dial');
    const a = ARC_END[from.rank];
    const b = ARC_END[to.rank];
    fx.append(under, over);
    if (up) sweep(over, sameColor ? a : 0, b, 250, 1086);
    else sweep(over, a, sameColor ? b : 0, 250, 1086);

    const oldNum = layer(from.svg, 'num');
    const newNum = layer(to.svg, 'num');
    fx.append(oldNum, newNum);
    rollNumber(oldNum, up ? 1 : -1, true, 0);
    rollNumber(newNum, up ? 1 : -1, false, 868);
  } else {
    // Into or out of Challenger: swap the emblems.
    const oldDial = layer(from.svg, 'all');
    const newDial = layer(to.svg, 'all');
    fx.append(oldDial, newDial);
    oldDial.animate(
      [
        { transform: 'none', opacity: 1 },
        up
          ? { transform: 'scale(0.4) rotate(-120deg)', opacity: 0 }
          : { transform: 'translateY(14%) scale(0.75)', opacity: 0 },
      ],
      { duration: 635, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' },
    );
    newDial.animate(
      [
        up
          ? { transform: 'scale(0.3) rotate(120deg)', opacity: 0 }
          : { transform: 'translateY(-14%) scale(0.75)', opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 1086, delay: 468, easing: SPRING, fill: 'backwards' },
    );
  }

  // The Challenger position pill pops in on the way up; on the way down a copy
  // of the old one shrinks away.
  const pos = rankEl.querySelector<HTMLElement>('.faceit-pos');
  if (pos && !from.pos) {
    pos.animate(
      [
        { transform: 'translateX(-50%) scale(0.5)', opacity: 0 },
        { transform: 'translateX(-50%)', opacity: 1 },
      ],
      { duration: 835, delay: 1086, easing: SPRING, fill: 'backwards' },
    );
  } else if (!pos && from.pos) {
    const tmp = document.createElement('div');
    tmp.innerHTML = from.pos;
    const ghost = tmp.firstElementChild as HTMLElement;
    rankEl.appendChild(ghost);
    ghost
      .animate(
        [
          { transform: 'translateX(-50%)', opacity: 1 },
          { transform: 'translateX(-50%) translateY(6px) scale(0.5)', opacity: 0 },
        ],
        { duration: 501, easing: 'ease-in', fill: 'forwards' },
      )
      .finished.then(
        () => ghost.remove(),
        () => ghost.remove(),
      );
  }

  // The finish: a pop and a ring in the new colour for a level up, a little
  // shake for a level down.
  if (up) {
    fx.animate(
      [
        { transform: 'none', filter: `drop-shadow(0 0 0 ${to.color})` },
        { transform: 'scale(1.14)', filter: `drop-shadow(0 0 10px ${to.color})`, offset: 0.4 },
        { transform: 'none', filter: `drop-shadow(0 0 0 ${to.color})` },
      ],
      { duration: 835, delay: 1369, easing: EASE_OUT },
    );
    const ring = document.createElement('div');
    ring.className = 'rank-fx-ring';
    ring.style.borderColor = to.color;
    // Hidden until its turn (and after).
    ring.style.opacity = '0';
    fx.append(ring);
    ring.animate(
      [
        { transform: 'scale(0.9)', opacity: 0.9 },
        { transform: 'scale(1.4)', opacity: 0 },
      ],
      { duration: 1086, delay: 1369, easing: EASE_OUT },
    );
  } else {
    fx.animate(
      [
        { transform: 'none' },
        { transform: 'translateY(3px) rotate(-7deg)', offset: 0.25 },
        { transform: 'translateY(2px) rotate(5deg)', offset: 0.5 },
        { transform: 'translateY(1px) rotate(-2deg)', offset: 0.75 },
        { transform: 'none' },
      ],
      { duration: 802, delay: 1336, easing: 'ease-out' },
    );
  }

  setTimeout(() => {
    fx.remove();
    svg.style.visibility = '';
  }, RANK_MS);
}

// Remembers the last FACEIT rank shown and, after each re-render, animates the
// dial when it changed. The first render (and the first after the dial
// reappears) shows it as-is; the first-load entrance covers that.
export function createRankAnimator() {
  let prev: RankState | undefined;

  return function animateRank(root: HTMLElement) {
    const rankEl = root.querySelector<HTMLElement>('.faceit-rank[data-rank]');
    const svg = rankEl?.querySelector<SVGElement>(':scope > svg');
    if (!rankEl || !svg) {
      prev = undefined;
      return;
    }
    const cur: RankState = {
      rank: Number(rankEl.dataset.rank),
      color: rankEl.dataset.rankColor ?? '',
      svg: svg.outerHTML,
      pos: rankEl.querySelector('.faceit-pos')?.outerHTML ?? '',
    };
    const before = prev;
    prev = cur;
    if (!before || before.color === cur.color && before.rank === cur.rank || reducedMotion()) return;

    // The ELO beside the dial shares its colour, so fade it along.
    const elo = [...root.querySelectorAll<HTMLElement>('.faceit-elo')].find((el) => !el.closest('.slot-ghost'));
    elo?.animate([{ color: before.color }, { color: cur.color }], {
      duration: 1002,
      delay: 418,
      easing: 'ease-in-out',
      fill: 'backwards',
    });

    if (before.rank === cur.rank) {
      // Same rank, new colour: a Challenger moving into or out of the top three
      // (medal colours). Cross-fade the emblem.
      const fx = layer(before.svg, 'all');
      fx.classList.add('rank-fx');
      fx.setAttribute('aria-hidden', 'true');
      svg.after(fx);
      fx.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1002, easing: 'ease-in-out', fill: 'forwards' })
        .finished.then(
          () => fx.remove(),
          () => fx.remove(),
        );
      return;
    }
    playRankChange(rankEl, svg, before, cur);
  };
}
