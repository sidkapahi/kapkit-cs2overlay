import { reducedMotion } from './animateNumbers';

// Same pace and curve as the customizer preview's resize (previewMotion.ts).
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const RESIZE_MS = 1125;

// Morphs the card's background from an earlier box (the loading skeleton's) to
// the card's current one, so a first-time player whose name is longer or
// shorter than the skeleton's stand-in grows or shrinks into place instead of
// snapping. A plate with the card's colour and corners animates between the two
// boxes while the card's own background is hidden.
export function morphCardFrom(widget: HTMLElement, from: DOMRect) {
  if (reducedMotion()) return;
  const to = widget.getBoundingClientRect();
  if (Math.abs(to.width - from.width) < 0.5 && Math.abs(to.height - from.height) < 0.5) return;
  const cs = getComputedStyle(widget);
  const radius = parseFloat(cs.borderTopLeftRadius) || 0;
  const box = (r: DOMRect) => ({
    left: `${r.left + window.scrollX}px`,
    top: `${r.top + window.scrollY}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
  const plate = document.createElement('div');
  plate.setAttribute('aria-hidden', 'true');
  Object.assign(plate.style, {
    position: 'absolute',
    background: cs.backgroundColor,
    borderRadius: `${Math.min(radius, to.height / 2, from.height / 2)}px`,
    pointerEvents: 'none',
    ...box(to),
  });
  document.body.appendChild(plate);
  widget.style.backgroundColor = 'transparent';
  // Keep the card painting above the plate.
  widget.style.position = 'relative';
  widget.style.zIndex = '1';
  const anim = plate.animate([box(from), box(to)], { duration: RESIZE_MS, easing: EASE });
  const finish = () => {
    plate.remove();
    widget.style.backgroundColor = '';
    widget.style.position = '';
    widget.style.zIndex = '';
  };
  anim.finished.then(finish, finish);
}
