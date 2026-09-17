// Cookieless overlay analytics. The OBS overlay only needs to fire a few
// anonymous count events, so instead of bundling posthog-js (~120KB gzipped) it
// POSTs straight to PostHog's ingestion endpoint. No cookies, no storage, so
// nothing needs consent and there's no banner on stream.

type Props = Record<string, string | number | boolean>;

const POSTHOG_KEY: string = import.meta.env.VITE_POSTHOG_KEY ?? "";
// Use || (not ??) so an *empty* host falls back to the US default. CI passes an
// empty string (not undefined) when VITE_POSTHOG_HOST is unset; with ?? that
// would make the fetch below POST to a relative "/capture/" on our own origin
// and silently drop every overlay event.
const POSTHOG_HOST: string =
  import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";
const ENABLED = !!POSTHOG_KEY;

// Namespace every event with this prefix so the overlay's events group together
// and don't collide with other apps sharing the same PostHog project (e.g. the
// `crtsim_` events). Applied centrally in trackOverlayEvent, so call sites keep
// their short names and nothing can be sent unprefixed. Must match the prefix in
// analytics.ts so both surfaces report under one namespace.
const EVENT_PREFIX = "cs2overlay_";

// Random id, held in memory only and regenerated every load — cookieless by
// construction. Two loads of the same overlay look like two anonymous visitors,
// which is the accepted trade-off for not storing anything.
let distinctId = "";

export function initOverlayAnalytics() {
  if (!ENABLED || distinctId || typeof window === "undefined") return;
  distinctId = crypto.randomUUID?.() ?? `anon-${Math.random().toString(36).slice(2)}`;
}

export function trackOverlayEvent(event: string, props?: Props) {
  if (!ENABLED || !distinctId) return;
  try {
    const body = JSON.stringify({
      api_key: POSTHOG_KEY,
      event: `${EVENT_PREFIX}${event}`,
      distinct_id: distinctId,
      // Keep these events anonymous — never create a PostHog person profile.
      properties: { ...props, $process_person_profile: false },
    });
    // keepalive so an event fired right as the source reloads still sends.
    void fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // analytics must never break the overlay
  }
}
