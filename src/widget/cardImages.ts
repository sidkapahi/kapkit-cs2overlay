// Makes sure the card's images (the FACEIT flag and region icon, the Premier
// avatar, the kapKit logo) show on the first load, not just on a later one.
//
// The <img> tags only appear once the stats arrive, so before this a cold
// load (an OBS source refresh, a new-deploy reload) only started fetching the
// flag at the moment the intro began: it could pop in late, and if that one
// request failed the flag stayed blank for the whole stream, because the
// overlay only rewrites the card when the stats change.
//
// So: start fetching the images we expect as soon as the page loads (from the
// skeleton hint), hold the first real render a moment until the real card's
// images are ready, and retry any card image that fails to load.

// The longest the first render waits on images. A slow image still loads into
// the card afterwards; this only stops a stalled one from holding up the card.
const FIRST_RENDER_WAIT_MS = 1500;
// Retries for an image that fails, spaced out further each time.
const RETRY_DELAYS_MS = [1000, 3000, 8000, 20000, 60000];

// Preloaded images, kept referenced so they stay in the page's memory cache.
const preloaded = new Map<string, Promise<void>>();

// Fetches and decodes `src` once; resolves when it's ready or has failed.
function preload(src: string): Promise<void> {
  let ready = preloaded.get(src);
  if (!ready) {
    const img = new Image();
    img.src = src;
    ready = img.decode().catch(() => {
      // Failed: forget it so a later call tries again.
      preloaded.delete(src);
    });
    preloaded.set(src, ready);
  }
  return ready;
}

// Every <img> source in a chunk of card markup.
function imageSources(html: string): string[] {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return [...tpl.content.querySelectorAll('img')]
    .map((img) => img.getAttribute('src') ?? '')
    .filter((src) => src !== '');
}

// Starts fetching these images now, without waiting on them.
export function warmImages(srcs: (string | undefined)[]): void {
  for (const src of srcs) if (src) void preload(src);
}

// Resolves once every image in `html` is loaded and decoded, or after
// FIRST_RENDER_WAIT_MS, whichever comes first.
export function imagesReady(html: string): Promise<void> {
  const all = Promise.all(imageSources(html).map(preload)).then(() => undefined);
  const timeout = new Promise<void>((r) => setTimeout(r, FIRST_RENDER_WAIT_MS));
  return Promise.race([all, timeout]);
}

// Retries any image in `root` that fails to load (a dropped request on a cold
// load, a proxy blip), with a cache-busting query so the browser asks again.
export function retryFailedImages(root: HTMLElement): void {
  const tries = new WeakMap<HTMLImageElement, number>();
  // `error` doesn't bubble, so listen in the capture phase.
  root.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement)) return;
      // Inline images (the logo, the default avatar) can't fail to fetch.
      if (img.getAttribute('src')?.startsWith('data:')) return;
      const n = tries.get(img) ?? 0;
      if (n >= RETRY_DELAYS_MS.length) return;
      tries.set(img, n + 1);
      const base = img.getAttribute('src')!.replace(/[?&]retry=\d+$/, '');
      setTimeout(() => {
        if (!img.isConnected) return;
        img.src = `${base}${base.includes('?') ? '&' : '?'}retry=${n + 1}`;
      }, RETRY_DELAYS_MS[n]);
    },
    true,
  );
}
