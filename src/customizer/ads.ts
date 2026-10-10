// AdSense unit placement for the customizer (never imported by the overlay or
// the ZIP export). The loader script itself is in index.html's <head>.
//
// Wide screens show the unit in both gutters beside the layout; narrower
// screens show it once below the page. Only slots that are visible get an
// <ins> and a push: AdSense errors on a hidden (zero-width) slot, so a slot
// that later becomes visible (window resized across the breakpoint) is filled
// then.

const AD_CLIENT = "ca-pub-3407819031872879";
const AD_SLOT = "5068506105";
// Keep in sync with the gutter media query in customizer.css.
const GUTTER_QUERY = "(min-width: 1900px)";

type AdsQueue = { push: (o: object) => void };

function fillSlot(slot: HTMLElement) {
  if (slot.dataset.filled) return;
  slot.dataset.filled = "1";
  const ins = document.createElement("ins");
  ins.className = "adsbygoogle";
  ins.style.display = "block";
  ins.dataset.adClient = AD_CLIENT;
  ins.dataset.adSlot = AD_SLOT;
  ins.dataset.adFormat = "auto";
  ins.dataset.fullWidthResponsive = "true";
  slot.appendChild(ins);
  const w = window as unknown as { adsbygoogle?: AdsQueue | object[] };
  try {
    (w.adsbygoogle = w.adsbygoogle || []).push({});
  } catch {
    // Blocked or failed loader: leave the slot empty.
  }
}

export function initAds() {
  const body = document.body;
  const make = (side: string) => {
    const el = document.createElement("aside");
    el.className = `ad-slot ad-slot--${side}`;
    el.setAttribute("aria-label", "Advertisement");
    body.appendChild(el);
    return el;
  };
  const left = make("left");
  const right = make("right");
  const bottom = make("bottom");

  const wide = window.matchMedia(GUTTER_QUERY);
  const place = () => {
    for (const slot of wide.matches ? [left, right] : [bottom]) fillSlot(slot);
  };
  place();
  wide.addEventListener("change", place);
}
