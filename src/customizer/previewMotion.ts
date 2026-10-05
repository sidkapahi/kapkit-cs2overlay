import { createNumberAnimator, playIntro, reducedMotion } from '../widget/animateNumbers';

// Animates the customizer's live preview the way the overlay animates on
// stream, plus transitions for the customizer's own changes: when a feature is
// switched on or off, the card's background morphs from its old size to its new
// one, the parts that stay slide to their new spots, and parts that just
// appeared fade in, and parts that went away fade out where they were. The same
// morph runs when PREMIER | FACEIT is flipped: the avatar fades into the rank
// dial, the name cross-fades, the rating rolls to the other number and takes
// on its colour. A new player (a new `key`) plays the overlay's first-load
// entrance instead.

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const RESIZE_MS = 1125;

// Top-level pieces tracked between renders: ones that stay slide to their new
// spot, ones that appear fade in. They don't nest, so a slide never compounds
// with its parent's. A stat is keyed by its own class so turning one stat on or
// off moves the others rather than re-keying them.
const MOVING_PARTS = ['.avatar', '.faceit-rank', '.identity-text', '.stat', '.wl', '.hist-letters', '.hist-brand'];
// Pieces inside those that only fade in when switched on.
const APPEARING_PARTS = ['.name', '.flag', '.diff-slot', '.rating-badge:not(.slot-ghost *)'];
const PART_SELECTOR = [...MOVING_PARTS, ...APPEARING_PARTS].join(', ');

function partKey(el: Element): string {
  if (el.classList.contains('stat')) {
    return [...el.classList].find((c) => c.startsWith('stat-')) ?? '.stat';
  }
  return [...MOVING_PARTS, ...APPEARING_PARTS].find((sel) => el.matches(sel)) ?? '';
}

interface PartSnapshot {
  rect: DOMRect;
  html: string;
  text: string;
}

function snapshotParts(root: HTMLElement): Map<string, PartSnapshot> {
  const map = new Map<string, PartSnapshot>();
  root.querySelectorAll<HTMLElement>(PART_SELECTOR).forEach((el) => {
    // Skip the invisible size placeholders (.slot-ghost, see numSlot in render.ts).
    if (el.closest('.slot-ghost')) return;
    map.set(partKey(el), { rect: el.getBoundingClientRect(), html: el.outerHTML, text: el.textContent ?? '' });
  });
  return map;
}

// The visible rating's colour (Premier's rank tier or FACEIT's level colour).
function ratingColor(root: HTMLElement): string {
  const el = [...root.querySelectorAll<HTMLElement>('.rating-plain, .rating-badge-text')].find(
    (e) => !e.closest('.slot-ghost'),
  );
  return el ? getComputedStyle(el).color : '';
}

// Puts a copy of a part that's gone (or been replaced) back where it was and
// fades it out. It sits in a wrapper carrying the old card's classes and
// inline style, so it keeps the text colour, font and tier tint it had.
function fadeOutGhost(body: HTMLElement, part: PartSnapshot, cardClass: string, cardStyle: string, scale: number) {
  const bodyRect = body.getBoundingClientRect();
  const wrap = document.createElement('div');
  // Without .widget itself, so nothing mistakes the copy for the card.
  wrap.className = cardClass.replace(/(^|\s)widget(?=\s|$)/, ' ').trim();
  wrap.setAttribute('style', cardStyle);
  wrap.style.color = '#f0f0f0';
  wrap.setAttribute('aria-hidden', 'true');
  Object.assign(wrap.style, {
    position: 'absolute',
    left: `${part.rect.left - bodyRect.left}px`,
    top: `${part.rect.top - bodyRect.top}px`,
    width: `${part.rect.width / scale}px`,
    height: `${part.rect.height / scale}px`,
    padding: '0',
    background: 'transparent',
    display: 'block',
    transform: `scale(${scale})`,
    transformOrigin: '0 0',
    pointerEvents: 'none',
    zIndex: '1',
  });
  wrap.innerHTML = part.html;
  body.appendChild(wrap);
  wrap
    .animate([{ opacity: 1 }, { opacity: 0, transform: `scale(${scale * 0.9})` }], {
      duration: RESIZE_MS * 0.6,
      easing: EASE,
      fill: 'forwards',
    })
    .finished.then(
      () => wrap.remove(),
      () => wrap.remove(),
    );
}

export function createPreviewAnimator() {
  let animateNumbers = createNumberAnimator();
  let lastData: unknown = null;
  let lastHtml = '';
  let lastWidget: HTMLElement | null = null;
  // The background "plate" morphing between card sizes, and the cleanup that
  // ends it early if another change comes in mid-animation.
  let plate: HTMLElement | null = null;
  let endResize: (() => void) | null = null;

  // Renders `html` into `body`, calls `fit` to scale it to the panel, and
  // animates the change. `key` identifies the loaded player: a new one gets the
  // first-load entrance, the same one (a toggle, or a provider switch) morphs.
  return function update(body: HTMLElement, html: string, key: unknown, fit: () => void) {
    // Nothing changed (and it's still on screen): leave running animations be.
    if (html === lastHtml && lastWidget?.isConnected) {
      fit();
      return;
    }
    const oldWidget = body.querySelector<HTMLElement>('.widget');
    const isWidget = html.includes('class="widget ');
    const newPlayer = key !== lastData;
    lastHtml = html;
    lastData = key;

    // Where things were before this change (the plate, if one is mid-morph,
    // shows the card's current visible size).
    const oldRect = (plate ?? oldWidget)?.getBoundingClientRect();
    const oldParts = oldWidget ? snapshotParts(oldWidget) : new Map<string, PartSnapshot>();
    const oldClass = oldWidget?.className ?? '';
    const oldStyle = oldWidget?.getAttribute('style') ?? '';
    const oldColor = oldWidget ? ratingColor(oldWidget) : '';
    const oldScale = oldWidget ? oldWidget.getBoundingClientRect().width / oldWidget.offsetWidth || 1 : 1;
    endResize?.();

    body.innerHTML = html;
    fit();
    const widget = body.querySelector<HTMLElement>('.widget');
    lastWidget = widget;
    if (!widget || !isWidget) return;

    if (newPlayer || !oldWidget || !oldRect) {
      animateNumbers = createNumberAnimator();
      playIntro(body);
      animateNumbers(body);
      return;
    }
    animateNumbers(body);
    if (reducedMotion()) return;

    const scale = widget.getBoundingClientRect().width / widget.offsetWidth || 1;

    // Parts that stayed slide from their old spot; new ones fade in, and a name
    // that changed (a provider switch: Steam name vs FACEIT nickname)
    // cross-fades with a copy of the old one.
    const seen = new Set<string>();
    widget.querySelectorAll<HTMLElement>(PART_SELECTOR).forEach((el) => {
      if (el.closest('.slot-ghost')) return;
      const key = partKey(el);
      seen.add(key);
      let before = oldParts.get(key);
      if (before && key === '.name' && before.text !== el.textContent) {
        fadeOutGhost(body, before, oldClass, oldStyle, oldScale);
        before = undefined;
      }
      if (!before) {
        el.animate(
          [
            { opacity: 0, transform: 'scale(0.85)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: RESIZE_MS, easing: EASE, delay: 300, fill: 'backwards' },
        );
        return;
      }
      if (!el.matches(MOVING_PARTS.join(', '))) return;
      const now = el.getBoundingClientRect();
      const dx = (before.rect.left - now.left) / scale;
      const dy = (before.rect.top - now.top) / scale;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: RESIZE_MS,
        easing: EASE,
      });
    });

    // Parts that are gone fade out where they were.
    oldParts.forEach((part, key) => {
      if (!seen.has(key)) fadeOutGhost(body, part, oldClass, oldStyle, oldScale);
    });

    // The rating takes on its new colour (rank tier ↔ FACEIT level) gradually.
    const newColor = ratingColor(widget);
    if (oldColor && newColor && oldColor !== newColor) {
      const el = [...widget.querySelectorAll<HTMLElement>('.rating-plain, .rating-badge-text')].find(
        (e) => !e.closest('.slot-ghost'),
      );
      el?.animate([{ color: oldColor }, { color: newColor }], { duration: 1500, easing: 'ease-in-out' });
    }

    // Morph the card's background from its old size to its new one: a plate
    // with the card's colour and corners animates between the two boxes while
    // the card's own background is hidden.
    const newRect = widget.getBoundingClientRect();
    if (Math.abs(newRect.width - oldRect.width) < 0.5 && Math.abs(newRect.height - oldRect.height) < 0.5) return;
    const cs = getComputedStyle(widget);
    const bodyRect = body.getBoundingClientRect();
    const radius = (parseFloat(cs.borderTopLeftRadius) || 0) * scale;
    const box = (r: DOMRect) => ({
      left: `${r.left - bodyRect.left}px`,
      top: `${r.top - bodyRect.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    const p = document.createElement('div');
    p.setAttribute('aria-hidden', 'true');
    Object.assign(p.style, {
      position: 'absolute',
      background: cs.backgroundColor,
      borderRadius: `${Math.min(radius, newRect.height / 2, oldRect.height / 2)}px`,
      pointerEvents: 'none',
      ...box(newRect),
    });
    body.insertBefore(p, widget);
    widget.style.backgroundColor = 'transparent';
    // Keep the card painting above the plate (positioned, later in the DOM).
    widget.style.position = 'relative';
    plate = p;
    const anim = p.animate([box(oldRect), box(newRect)], { duration: RESIZE_MS, easing: EASE });
    const finish = () => {
      if (plate !== p) return;
      anim.cancel();
      p.remove();
      widget.style.backgroundColor = '';
      widget.style.position = '';
      plate = null;
      endResize = null;
    };
    endResize = finish;
    anim.finished.then(finish, () => {});
  };
}
