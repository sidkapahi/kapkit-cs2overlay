// What follows the cursor while the OBS field is dragged. Browsers draw a
// snapshot of one element as the drag image, and only that snapshot can follow
// the cursor out of the window and over OBS, so the ghost is a real element
// rendered for a moment and handed to setDragImage.
//
// Three looks, switchable from the ?dragtest panel while we pick one:
// "card" (the overlay itself), "field" (the OBS field lifts off) and "native"
// (the browser's own faded copy of the field).

export type DragGhostStyle = "card" | "field" | "native";

export const dragGhost = {
  style: "card" as DragGhostStyle,
  // Card ghost size relative to the real overlay.
  scale: 0.6,
};

// Builds the ghost, hands it to the drag and removes it once the browser has
// taken its snapshot. `cardHtml` is the overlay markup at its real size.
export function setDragGhost(e: DragEvent, field: HTMLElement, cardHtml: string) {
  if (!e.dataTransfer || dragGhost.style === "native") return;

  const holder = document.createElement("div");
  holder.className = "drag-ghost";
  holder.setAttribute("aria-hidden", "true");

  let x: number;
  let y: number;
  if (dragGhost.style === "card") {
    holder.innerHTML = cardHtml;
    holder.style.zoom = String(dragGhost.scale);
    document.body.append(holder);
    // The cursor holds the card by its middle.
    const rect = holder.getBoundingClientRect();
    x = rect.width / 2;
    y = rect.height / 2;
  } else {
    const rect = field.getBoundingClientRect();
    const clone = field.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    clone.classList.remove("copied", "copy-pressed", "is-dragging");
    clone.classList.add("is-ghost");
    clone.style.width = `${rect.width}px`;
    // NumberFlow draws its digits in a shadow root, which cloning leaves
    // behind; show the size as plain text instead.
    const size = clone.querySelector<HTMLElement>(".obs-drag-size");
    const measure = field.querySelector<HTMLElement>(".obs-size-measure");
    if (size && measure) size.textContent = measure.textContent;
    holder.append(clone);
    document.body.append(holder);
    // The cursor keeps the spot it grabbed.
    x = e.clientX - rect.left;
    y = e.clientY - rect.top;
  }

  e.dataTransfer.setDragImage(holder, x, y);
  setTimeout(() => holder.remove());
}

// A small floating panel (only with ?dragtest in the URL) for trying the
// looks on the real page before one is picked.
export function initDragTestPanel() {
  if (!new URLSearchParams(location.search).has("dragtest")) return;
  const panel = document.createElement("div");
  panel.className = "drag-test";
  panel.innerHTML = `
    <strong>Drag preview</strong>
    <label><input type="radio" name="dg" value="card" checked> Stat card</label>
    <label><input type="radio" name="dg" value="field"> Link field</label>
    <label><input type="radio" name="dg" value="native"> Browser default</label>
    <label class="drag-test-scale">Card size <input type="range" min="0.3" max="1" step="0.05" value="${dragGhost.scale}"> <span>${Math.round(dragGhost.scale * 100)}%</span></label>
  `;
  panel.addEventListener("input", (ev) => {
    const input = ev.target as HTMLInputElement;
    if (input.type === "radio") dragGhost.style = input.value as DragGhostStyle;
    if (input.type === "range") {
      dragGhost.scale = Number(input.value);
      panel.querySelector("span")!.textContent = `${Math.round(dragGhost.scale * 100)}%`;
    }
  });
  document.body.append(panel);
}
