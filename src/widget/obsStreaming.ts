import { trackOverlayEvent } from '../shared/analyticsOverlay';

// Counts how many overlays are on a live stream right now, including streamers
// who never entered a channel. OBS gives every browser source a small API
// (`window.obsstudio`) that says whether OBS is streaming. While it is, the
// overlay sends an anonymous `obs_streaming` ping every minute; the "Live right
// now" tile in PostHog counts overlays heard from in the last few minutes.
// Nothing here identifies the streamer: no channel, no Steam ID.
//
// Only OBS has this API. In Streamlabs, StreamElements or a normal browser tab
// `window.obsstudio` is missing and this does nothing. Reading the status needs
// the browser source's page permission to be at least "Read access to status
// information about OBS", which OBS's default permission level includes.

const PING_INTERVAL_MS = 60 * 1000;

interface ObsStatus {
  streaming?: boolean;
}

interface ObsStudio {
  getStatus?: (cb: (status: ObsStatus | null) => void) => void;
}

function obs(): ObsStudio | undefined {
  return (window as unknown as { obsstudio?: ObsStudio }).obsstudio;
}

export function watchObsStreaming(props: Record<string, string | boolean>) {
  const api = obs();
  if (!api) return;

  let streaming = false;
  let lastPing = 0;

  function ping() {
    if (!streaming) return;
    // Throttled by time, not by the timer alone: OBS can freeze a hidden
    // source's timers, so the wake events below call this too.
    if (Date.now() - lastPing < PING_INTERVAL_MS - 5000) return;
    lastPing = Date.now();
    trackOverlayEvent('obs_streaming', props);
  }

  function setStreaming(next: boolean) {
    if (next === streaming) return;
    streaming = next;
    if (streaming) {
      trackOverlayEvent('obs_stream_started', props);
      lastPing = 0;
      ping();
    }
  }

  // Ask OBS directly. Events alone aren't enough: the overlay often loads after
  // the stream already started, and a missed stop event would leave us pinging.
  function check() {
    try {
      api?.getStatus?.((status) => {
        if (status && typeof status.streaming === 'boolean') setStreaming(status.streaming);
        ping();
      });
    } catch {
      // No permission or an old OBS: fall back to the start/stop events.
      ping();
    }
  }

  window.addEventListener('obsStreamingStarted', () => setStreaming(true));
  window.addEventListener('obsStreamingStopped', () => setStreaming(false));
  check();
  setInterval(check, PING_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') check();
  });
}
