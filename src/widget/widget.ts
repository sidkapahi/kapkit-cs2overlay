import { initOverlayAnalytics, trackOverlayEvent } from '../shared/analyticsOverlay';
import { classifyFetchError, errorDetail, fetchPremierData, type PremierData } from '../shared/api';
import { fetchFaceitData } from '../shared/faceit';
import { faceitHistoryCount, paramsToConfig } from '../shared/config';
import { loadFont } from '../shared/fonts';
import { renderMessage, renderWidget } from '../shared/render';
import {
  advanceSession,
  loadSession,
  readWinLoss,
  saveSession,
  type SessionState,
} from '../shared/session';
import { fetchLive, liveCheckAvailable } from '../shared/live';
import { createNumberAnimator, playIntro } from './animateNumbers';
import { takeReloadStash, watchForNewBuild } from './autoReload';
import './widget.css';

// How often to check stream live status, independent of the (slower) stats
// refresh. Matches finish every 30+ minutes so there's no point polling Leetify
// fast, but we want a go-live / go-offline transition caught quickly. The proxy
// Workers cache their upstream calls, so a 15s (4/min) poll stays cheap even on
// YouTube's tight API quota.
const LIVE_POLL_INTERVAL = 15;

// While the stream is live, the overlay sends a `live_heartbeat` at most this
// often, so a "live now" view in PostHog can list who is streaming with it right
// now (anyone heard from within the last couple of heartbeats).
const LIVE_HEARTBEAT_INTERVAL_MS = 60 * 1000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function init() {
  const container = document.getElementById('app')!;
  const params = new URLSearchParams(window.location.search);
  const config = paramsToConfig(params);

  // Pull in the chosen Google Font at the chosen weight (Inter is already bundled).
  loadFont(config.font, config.fontWeight);

  if (!config.steamId) {
    container.innerHTML = renderMessage('Error', 'No Steam ID provided.');
    return;
  }

  // If this load is the overlay reloading itself onto a new deploy, put back
  // exactly what was on screen so the swap is invisible on stream.
  const stash = takeReloadStash();
  container.innerHTML =
    stash ??
    `<div class="widget rank-gray no-badge no-avatar loading">
    <div class="widget-main"><div class="identity"><div class="identity-text">
      <div class="name">Loading…</div>
      <div class="rating-line"><span class="rating-plain">—</span></div>
    </div></div></div>
  </div>`;

  // Session-scoped W/L is active only when a live channel is set *and* that
  // platform's proxy is configured; otherwise the pills keep their default
  // rolling-window behaviour.
  const sessionMode =
    !!config.livePlatform &&
    !!config.liveChannel &&
    liveCheckAvailable(config.livePlatform);
  let sessionState: SessionState = sessionMode
    ? loadSession(config.steamId, config.livePlatform, config.liveChannel)
    : { live: false, preSessionIds: [], results: {} };

  // Overlay analytics: cookieless (no cookies, no storage, no consent banner on
  // stream). One overlay_active per load counts active overlays; go-live
  // sessions and fetch errors are tracked below. Cookieless means loads aren't
  // linked across sessions, so these are counts, not unique-user figures.
  initOverlayAnalytics();
  trackOverlayEvent('overlay_active', {
    live: sessionMode,
    platform: sessionMode ? config.livePlatform : '',
  });
  // Latest stats payload and latest known live status, updated by two separate
  // pollers and reconciled by render().
  let lastData: PremierData | null = null;
  let lastLive: boolean | null = null;
  // When the last stats refresh was *kicked off* (ms epoch). Used to throttle the
  // wake-driven catch-up refreshes below so they don't stack on the interval or
  // on each other while still recovering promptly after the timer was frozen.
  let lastStatsAttempt = 0;
  // Tracks fetch health so an outage fires overlay_error once (on the failing
  // transition), not on every poll while Leetify stays down.
  let statsHealthy = true;
  // When the last live_heartbeat went out (ms epoch); 0 = none this load.
  let lastHeartbeat = 0;
  // The markup last written to the page. render() runs on every live/stats poll,
  // so skipping identical markup keeps an in-flight number animation (and the
  // images) from being torn down when nothing actually changed.
  // Seeded with the restored markup after an update reload, so the first render
  // neither replays the entrance nor redraws identical markup.
  let lastHtml = stash ?? '';
  // Rolls each changed number from its previous value instead of swapping it.
  const animateNumbers = createNumberAnimator();
  // After an update reload, numbers roll from what was already showing, not from 0.
  if (stash) animateNumbers(container, false);

  // Renders whatever we currently know. In session mode it advances the session
  // from the newest live status + matches, then overrides the W/L pills with the
  // session record (falling back to the rolling window before the first stream).
  function render() {
    if (!lastData) return;
    let data = lastData;
    if (sessionMode) {
      const wasLive = sessionState.live;
      sessionState = advanceSession(sessionState, lastLive, lastData.recentGames, lastData.rating);
      // A false→true flip is a fresh stream session starting; count it once.
      // (An OBS source refresh reloads the persisted live=true state, so it
      // won't re-fire — we count real go-live transitions, not refreshes.)
      const liveProps = { platform: config.livePlatform, channel: config.liveChannel };
      if (!wasLive && sessionState.live) {
        trackOverlayEvent('live_session_started', liveProps);
      }
      // Heartbeat while live, throttled by time rather than a timer: render()
      // runs on every live/stats poll, and OBS can freeze a hidden source's
      // timers, so this also resumes on the wake-driven refreshes.
      if (sessionState.live && Date.now() - lastHeartbeat >= LIVE_HEARTBEAT_INTERVAL_MS) {
        lastHeartbeat = Date.now();
        trackOverlayEvent('live_heartbeat', liveProps);
      }
      saveSession(config.steamId, config.livePlatform, config.liveChannel, sessionState);
      const wl = readWinLoss(sessionState);
      if (wl.mode === 'session') {
        data = { ...lastData, wins: wl.wins, losses: wl.losses };
      }
      // Live-session mode scopes the loss/gain to the stream too, so it tracks the
      // W/L toggle: the change pill shows the rating gained/lost this stream —
      // current − the go-live snapshot — for both providers. (In total mode
      // there's no snapshot, so the pill keeps the API's rolling-window diff:
      // FACEIT's session swing / Premier's last-match swing.)
      if (sessionState.startRating != null && lastData.rating != null) {
        data = { ...data, ratingDiff: lastData.rating - sessionState.startRating };
      }
    }
    const html = renderWidget(config, data);
    if (html === lastHtml) return;
    // The first real render (lastHtml still empty) also plays the entrance.
    const first = !lastHtml;
    lastHtml = html;
    container.innerHTML = html;
    if (first) playIntro(container);
    animateNumbers(container);
  }

  const fetchStats = () =>
    config.provider === 'faceit'
      ? fetchFaceitData(config.steamId, faceitHistoryCount(config))
      : fetchPremierData(config.steamId);

  async function updateStats() {
    lastStatsAttempt = Date.now();
    let lastError: unknown;
    // Retry once after a short backoff before declaring an outage. A lone
    // failure on a single poll — a transient network blip or a proxy cold start,
    // both common in OBS's browser source — shouldn't count as an error episode;
    // only a failure that survives the retry is treated as real.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        lastData = await fetchStats();
        statsHealthy = true;
        render();
        return;
      } catch (e) {
        lastError = e;
        if (attempt === 0) await delay(2000);
      }
    }
    // Both attempts failed — a genuine outage. Fire once per episode (on the
    // healthy→failing transition), so a sustained outage doesn't emit an event
    // on every refresh. `detail` and `provider` make an otherwise-opaque
    // `other`/`network_error` diagnosable.
    if (statsHealthy) {
      trackOverlayEvent('overlay_error', {
        reason: classifyFetchError(lastError),
        detail: errorDetail(lastError),
        provider: config.provider,
      });
    }
    statsHealthy = false;
    // Keep the last good render if we already have one (including the markup
    // restored after an update reload); only show the error state on the very
    // first failure.
    if (!lastHtml) {
      container.innerHTML = renderMessage(
        'Error',
        lastError instanceof Error ? lastError.message : 'Failed to fetch',
      );
    }
  }

  async function updateLive() {
    const live = await fetchLive(config.livePlatform, config.liveChannel);
    // null means "unknown" (transient) — leave lastLive as-is so a blip can't be
    // misread as the stream ending.
    if (live !== null) lastLive = live;
    render();
  }

  // Kick off the live check first so the very first stats render already knows
  // whether we're live (avoids a flash of the wrong W/L).
  if (sessionMode) await updateLive();
  await updateStats();

  setInterval(updateStats, config.refreshInterval * 1000);
  if (sessionMode) setInterval(updateLive, LIVE_POLL_INTERVAL * 1000);

  // OBS renders each browser source in Chromium, which aggressively throttles —
  // and can outright freeze — a page's timers while its source is hidden,
  // occluded by another scene, or backgrounded. The interval above then stops
  // firing, so the on-screen stats sit frozen at their last values with no
  // error (the fetch code is fine — a manual source refresh always fixes it).
  // Refetch immediately whenever the source comes back to the foreground so the
  // overlay self-heals the way a manual refresh would, with no visible change.
  // The throttle keeps a burst of these events (or one firing right after an
  // interval poll) from hammering the API.
  function refreshOnWake() {
    if (document.visibilityState === 'hidden') return;
    if (Date.now() - lastStatsAttempt < LIVE_POLL_INTERVAL * 1000) return;
    updateStats();
    if (sessionMode) updateLive();
  }
  document.addEventListener('visibilitychange', refreshOnWake);
  // `pageshow` covers a restore from the bfcache; `focus`/`online` cover the
  // browser-tab and Streamlabs cases where visibilitychange may not fire.
  window.addEventListener('pageshow', refreshOnWake);
  window.addEventListener('focus', refreshOnWake);
  window.addEventListener('online', refreshOnWake);

  // Reload onto a new deploy when one goes live.
  watchForNewBuild(container, () => lastHtml);
}

init();
