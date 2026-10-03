import { fetchWithTimeout } from '../shared/fetchWithTimeout';

// Picks up new deploys in overlays that are already open.
//
// An OBS browser source loads the overlay once and can then sit there for days,
// so without this a push to main only reaches streamers who manually refresh the
// source. Every build stamps its own id into the bundle (__BUILD_ID__) and writes
// the same id to /version.json (see vite.config.ts). The overlay polls that file
// and, once it names a different build, reloads itself at a quiet moment: right
// away if the source is hidden, otherwise as soon as no animation is running.
// It's a plain location.reload() of the same URL, so the URL params carry over
// and the overlay comes back exactly like a fresh load, entrance included.

// How often to ask the site which build is live. version.json is a tiny static
// asset, so this is cheap; a minute keeps a deploy rolling out about as fast as
// the default stats refresh.
const VERSION_POLL_MS = 60 * 1000;

// While a reload is pending on a visible overlay, how often to look for a gap
// between animations.
const QUIET_CHECK_MS = 500;

// Never hold a reload back forever (e.g. an animation that never finishes).
const MAX_WAIT_MS = 30 * 1000;

// The build we last reloaded for. If the reload still comes back as the old
// bundle (a stale cache somewhere), don't keep reloading for the same build.
const TRIED_KEY = 'cs2overlay:reload-tried';

function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked: only the reload-loop guard is lost.
  }
}

async function fetchLiveBuild(): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { build?: unknown };
    return typeof body.build === 'string' ? body.build : null;
  } catch {
    return null;
  }
}

// True while anything on the page is mid-animation: the first-load entrance,
// a number roll, the gain arrow or the match-history slide.
function busy(container: HTMLElement): boolean {
  if (container.classList.contains('intro')) return true;
  return document.getAnimations().some((a) => a.playState === 'running');
}

// Starts watching for new deploys.
export function watchForNewBuild(container: HTMLElement) {
  // `vite dev` has no version.json and reloads itself anyway.
  if (import.meta.env.DEV) return;

  let pending: string | null = null;
  let pendingSince = 0;

  function reloadNow() {
    storageSet(TRIED_KEY, pending);
    location.reload();
  }

  function tryReload() {
    if (!pending) return;
    if (
      document.visibilityState === 'hidden' ||
      !busy(container) ||
      Date.now() - pendingSince > MAX_WAIT_MS
    ) {
      reloadNow();
      return;
    }
    setTimeout(tryReload, QUIET_CHECK_MS);
  }

  async function check() {
    if (pending) return;
    const live = await fetchLiveBuild();
    if (!live || live === __BUILD_ID__ || live === storageGet(TRIED_KEY)) return;
    pending = live;
    pendingSince = Date.now();
    tryReload();
  }

  setInterval(check, VERSION_POLL_MS);
  // OBS can freeze a hidden source's timers (see refreshOnWake in widget.ts), so
  // also check when it comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') check();
  });
}
