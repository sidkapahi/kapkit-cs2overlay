// A ticker for text that isn't (only) a number, like the FACEIT rank cycle's
// name ↔ rank change. NumberFlow only rolls digits, so this rolls each
// character column on its own: a short reel of characters spins from the old
// character to the new one, the columns start one after another from the
// left, and each column's width eases from the old character's to the new
// one's, so the text reflows smoothly as it changes.

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
// How far apart (ms) neighbouring columns start.
const STAGGER_MS = 70;
// Characters each reel passes through between the old and the new one.
const FILLER = 3;
const DIGITS = '0123456789';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

const reelFiller = (to: string) => {
  const pool = /\d/.test(to) || !to.trim() ? DIGITS : LETTERS;
  return Array.from({ length: FILLER }, () => pool[Math.floor(Math.random() * pool.length)]);
};

// Splits into user-perceived characters, so an emoji or accented name stays whole.
const chars = (s: string) =>
  typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter().segment(s)].map((g) => g.segment)
    : [...s];

// Width of `ch` as `parent` would draw it.
function measure(parent: HTMLElement, ch: string): number {
  if (!ch) return 0;
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
  probe.textContent = ch;
  parent.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  return w;
}

// Rolls `from` into `to` inside `host` (a box in the same spot and font as the
// text). Resolves when the last column has landed; the caller then swaps in
// the real markup. `scale` undoes any transform on the card, so measurements
// match its own pixels.
export function tickText(
  host: HTMLElement,
  from: string,
  to: string,
  durationMs: number,
  scale = 1,
): Promise<void> {
  const a = chars(from);
  const b = chars(to);
  const n = Math.max(a.length, b.length);
  const lineH = host.getBoundingClientRect().height / scale || 24;
  const animations: Animation[] = [];
  host.replaceChildren();
  for (let i = 0; i < n; i++) {
    const oldCh = a[i] ?? '';
    const newCh = b[i] ?? '';
    const col = document.createElement('span');
    col.className = 'tick-col';
    const reel = document.createElement('span');
    reel.className = 'tick-reel';
    const cells = [oldCh, ...(oldCh === newCh ? [] : reelFiller(newCh)), newCh];
    for (const c of cells) {
      const cell = document.createElement('span');
      cell.textContent = c || ' ';
      if (!c) cell.style.visibility = 'hidden';
      reel.appendChild(cell);
    }
    col.appendChild(reel);
    host.appendChild(col);
    const w0 = measure(host, oldCh) / scale;
    const w1 = measure(host, newCh) / scale;
    const timing = { duration: durationMs, easing: EASE, delay: i * STAGGER_MS, fill: 'both' as const };
    col.style.width = `${w0}px`;
    animations.push(col.animate([{ width: `${w0}px` }, { width: `${w1}px` }], timing));
    animations.push(
      reel.animate(
        [{ transform: 'translateY(0)' }, { transform: `translateY(${-(cells.length - 1) * lineH}px)` }],
        timing,
      ),
    );
  }
  return Promise.all(animations.map((x) => x.finished)).then(
    () => undefined,
    () => undefined,
  );
}

export const tickTextDuration = (from: string, to: string, durationMs: number) =>
  durationMs + Math.max(chars(from).length, chars(to).length) * STAGGER_MS;
