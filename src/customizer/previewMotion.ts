import { createNumberAnimator, playIntro, reducedMotion } from '../widget/animateNumbers';

// Animates the customizer's live preview the way the overlay animates on
// stream, plus transitions for the customizer's own changes: when a feature is
// switched on or off, the card's background morphs from its old size to its new
// one, the parts that stay slide to their new spots, and parts that just
// appeared fade in. A new player (fresh preview data) plays the overlay's
// first-load entrance instead.

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const RESIZE_MS = 450;

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

function snapshotParts(root: HTMLElement): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>();
  root.querySelectorAll(PART_SELECTOR).forEach((el) => map.set(partKey(el), el.getBoundingClientRect()));
  return map;
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
  // animates the change. `data` is the preview's data object: a new one means
  // a new player, which gets the first-load entrance.
  return function update(body: HTMLElement, html: string, data: unknown, fit: () => void) {
    // Nothing changed (and it's still on screen): leave running animations be.
    if (html === lastHtml && lastWidget?.isConnected) {
      fit();
      return;
    }
    const oldWidget = body.querySelector<HTMLElement>('.widget');
    const isWidget = html.includes('class="widget ');
    const newPlayer = data !== lastData;
    lastHtml = html;
    lastData = data;

    // Where things were before this change (the plate, if one is mid-morph,
    // shows the card's current visible size).
    const oldRect = (plate ?? oldWidget)?.getBoundingClientRect();
    const oldParts = oldWidget ? snapshotParts(oldWidget) : new Map<string, DOMRect>();
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

    // Parts that stayed slide from their old spot; new ones fade in.
    widget.querySelectorAll<HTMLElement>(PART_SELECTOR).forEach((el) => {
      const key = partKey(el);
      const before = oldParts.get(key);
      if (!before) {
        el.animate(
          [
            { opacity: 0, transform: 'scale(0.85)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: RESIZE_MS, easing: EASE, delay: 120, fill: 'backwards' },
        );
        return;
      }
      if (!el.matches(MOVING_PARTS.join(', '))) return;
      const now = el.getBoundingClientRect();
      const dx = (before.left - now.left) / scale;
      const dy = (before.top - now.top) / scale;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: RESIZE_MS,
        easing: EASE,
      });
    });

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
