import { animate, createSpring, utils, type JSAnimation } from "animejs";

// While the OBS field is dragged, the overlay card itself follows the cursor:
// it pops out of the field, carries a marching dotted outline, tilts toward
// the movement and springs back into the field if the drag is cancelled.
//
// The card is drawn by the page rather than handed to setDragImage, because
// browsers (Windows especially) fade and gradient-mask drag images. A page
// can only draw inside its own window, so once the cursor heads out to OBS
// the card shrinks away and the cursor carries on alone; the drop still works.
//
// Tuned in the drag playground (https://claude.ai/artifact/JGpswb93wiiWm4oJLVv6nY):
// card at 60% size, "Medium" bounce.

const CARD_SCALE = 0.6;
const spring = (extra: { damping?: number } = {}) =>
  createSpring({ mass: 1, stiffness: 320, damping: 14, ...extra });
const MAX_TILT = 8;

// A 1x1 transparent GIF, so the browser draws no drag image of its own. It
// has to be loaded before the drag starts.
const blank = new Image();
blank.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initDragCard(field: HTMLElement) {
  // .drag-card moves with the cursor, .drag-card-lift carries the scale and
  // tilt, .drag-card-zoom shrinks the real-size card.
  const follower = document.createElement("div");
  follower.className = "drag-card";
  follower.setAttribute("aria-hidden", "true");
  follower.hidden = true;
  const lift = document.createElement("div");
  lift.className = "drag-card-lift";
  const zoom = document.createElement("div");
  zoom.className = "drag-card-zoom";
  zoom.style.zoom = String(CARD_SCALE);
  lift.append(zoom);
  follower.append(lift);
  document.body.append(follower);

  // A spring stops a hair off 1; clear it so the field's text stays crisp.
  const settleField = () => {
    field.style.transform = "";
  };

  let hold = { x: 0, y: 0 };
  let pos = { x: 0, y: 0 };
  let last: { x: number; t: number } | null = null;
  let marching: JSAnimation | null = null;
  let outside = false;

  const place = (x: number, y: number) => {
    pos = { x: x - hold.x, y: y - hold.y };
    follower.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  };

  // Press: the field squishes a little and springs back.
  field.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || reducedMotion() || field.classList.contains("is-disabled")) return;
    animate(field, { scale: 0.97, duration: 120, ease: "out(3)" });
  });
  const release = () => {
    if (!reducedMotion()) animate(field, { scale: 1, ease: spring(), onComplete: settleField });
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);

  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  field.addEventListener("dragend", onDragEnd);

  return {
    // Called from the field's dragstart once the drag is going ahead, with the
    // overlay's markup at its real size.
    start(e: DragEvent, cardHtml: string) {
      if (!e.dataTransfer) return;
      e.dataTransfer.setDragImage(blank, 0, 0);
      zoom.innerHTML = cardHtml;
      follower.hidden = false;
      const card = zoom.querySelector<HTMLElement>(".widget");
      if (card) zoom.prepend(dottedOutline(card.offsetWidth, card.offsetHeight));
      const rect = lift.getBoundingClientRect();
      hold = { x: rect.width / 2, y: rect.height / 2 };
      place(e.clientX, e.clientY);
      last = { x: e.clientX, t: performance.now() };
      outside = false;
      field.classList.add("is-dragging");

      const reduced = reducedMotion();
      utils.set(lift, { scale: reduced ? 1 : 0.35, rotate: reduced ? 0 : -8, opacity: 1 });
      if (reduced) return;
      animate(lift, { scale: 1, rotate: -2, ease: spring() });
      const rect2 = zoom.querySelector("rect");
      if (rect2) {
        const step = Number(rect2.dataset.step);
        marching = animate(rect2, {
          strokeDashoffset: [0, -step * 2],
          duration: 600,
          ease: "linear",
          loop: true,
        });
      }
    },
  };

  function dottedOutline(w: number, h: number) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "drag-card-dots");
    const rect = document.createElementNS(ns, "rect");
    // Sizes are in the card's own pixels, before the 60% zoom.
    const sw = 2.5 / CARD_SCALE;
    const step = 9 / CARD_SCALE;
    rect.setAttribute("x", String(sw / 2));
    rect.setAttribute("y", String(sw / 2));
    rect.setAttribute("width", String(w + 20 - sw));
    rect.setAttribute("height", String(h + 20 - sw));
    rect.setAttribute("rx", "28");
    rect.setAttribute("stroke-width", String(sw));
    rect.setAttribute("stroke-dasharray", `0 ${step}`);
    rect.dataset.step = String(step);
    svg.append(rect);
    return svg;
  }

  // Follow the cursor, and tilt toward the movement, while over the page.
  function onDragOver(e: DragEvent) {
    if (follower.hidden) return;
    place(e.clientX, e.clientY);
    const reduced = reducedMotion();
    if (outside) {
      outside = false;
      if (!reduced) animate(lift, { scale: 1, opacity: 1, ease: spring() });
      else utils.set(lift, { opacity: 1 });
    }
    if (reduced || !last) return;
    const now = performance.now();
    const vx = (e.clientX - last.x) / Math.max(16, now - last.t);
    last = { x: e.clientX, t: now };
    animate(lift, {
      rotate: utils.clamp(vx * 5, -MAX_TILT, MAX_TILT),
      ease: spring({ damping: 12 }),
      duration: 500,
    });
  }
  // Heading out of the window (towards OBS): shrink away.
  function onDragLeave(e: DragEvent) {
    if (follower.hidden || e.relatedTarget) return;
    outside = true;
    animate(lift, { scale: 0.4, opacity: 0, duration: 220, ease: "in(2)" });
  }
  function finish() {
    marching?.pause();
    marching = null;
    follower.hidden = true;
    zoom.innerHTML = "";
    field.classList.remove("is-dragging");
  }
  function onDragEnd(e: DragEvent) {
    if (follower.hidden) return;
    // Dropped (onto OBS): the card has gone where it was dropped.
    if (e.dataTransfer?.dropEffect !== "none" || reducedMotion()) {
      finish();
      return;
    }
    // Cancelled: spring back home into the field and vanish.
    const fr = field.getBoundingClientRect();
    const from = { ...pos };
    animate(from, {
      x: fr.left + fr.width / 2 - hold.x,
      y: fr.top + fr.height / 2 - hold.y,
      duration: 380,
      ease: "out(3)",
      onUpdate: () => {
        follower.style.transform = `translate(${from.x}px, ${from.y}px)`;
      },
    });
    animate(lift, {
      scale: 0.3,
      opacity: 0,
      rotate: 0,
      duration: 380,
      ease: "in(2)",
      onComplete: finish,
    });
    animate(field, { scale: [0.96, 1], ease: spring(), delay: 300, onComplete: settleField });
  }
}
