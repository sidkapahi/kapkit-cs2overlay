import posthog from "posthog-js";
import type { PostHogConfig } from "posthog-js";

// Customizer analytics (PostHog, cookie-based). The overlay does NOT use this
// module — it uses the lightweight, cookieless analyticsOverlay.ts instead, so
// posthog-js is never bundled into the OBS overlay.

type Props = Record<string, string | number | boolean>;

// PostHog project key + host, injected by Vite at build time. Empty key = no
// analytics at all (forks / local dev without their own project).
const POSTHOG_KEY: string = import.meta.env.VITE_POSTHOG_KEY ?? "";
// Use || (not ??) so an *empty* host falls back to the US default. CI passes
// `VITE_POSTHOG_HOST: ${{ vars.VITE_POSTHOG_HOST }}`, which is an empty string
// (not undefined) when the variable is unset — with ?? that empty string would
// stick and break ingestion.
const POSTHOG_HOST: string =
  import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";
const ENABLED = !!POSTHOG_KEY;

// When events are routed through a reverse proxy on our own domain (api_host set
// to e.g. https://t.kapkit.ca via PostHog's managed reverse proxy — see
// docs/ANALYTICS.md), posthog-js can no longer infer which PostHog app the
// customizer's toolbar / "open in PostHog" links should point at. `ui_host`
// tells it explicitly. When api_host is a real *.posthog.com ingestion host we
// return undefined and let posthog-js derive the app host itself (its US/EU
// default is already correct), so this stays a no-op when the proxy isn't used.
function deriveUiHost(apiHost: string): string | undefined {
  try {
    const host = new URL(apiHost).hostname;
    if (/\.posthog\.com$/i.test(host)) return undefined;
    // Custom proxy: this project targets US PostHog, whose app lives at
    // us.posthog.com. EU forks: change this to https://eu.posthog.com.
    return "https://us.posthog.com";
  } catch {
    return undefined;
  }
}

const POSTHOG_UI_HOST = deriveUiHost(POSTHOG_HOST);

// Namespace every custom event we send with this prefix, so this app's events
// group together and don't collide with other apps that share the same PostHog
// project (e.g. the `crtsim_` events). Applied centrally in trackEvent so call
// sites keep their short, readable names and no event can be sent unprefixed.
// PostHog's own automatic events ($pageview, $web_vitals, $opt_in, …) are sent
// by posthog-js and are intentionally left untouched.
const EVENT_PREFIX = "cs2overlay_";

let started = false;

// Cookie-based, but starts OPTED OUT — nothing is captured until the visitor
// accepts via the consent banner (see mountConsentUi in customizer.ts).
export function initAnalytics() {
  if (!ENABLED || started || typeof window === "undefined") return;
  started = true;

  const config: Partial<PostHogConfig> = {
    api_host: POSTHOG_HOST,
    // Only set when api_host is our reverse proxy; undefined otherwise (see
    // deriveUiHost) so posthog-js keeps its own correct default.
    ...(POSTHOG_UI_HOST ? { ui_host: POSTHOG_UI_HOST } : {}),
    autocapture: false, // we send explicit, named events only
    disable_session_recording: true,
    advanced_disable_feature_flags: true,
    // Never build person profiles for anonymous events — cheaper and more
    // private; we only ever send anonymous counts.
    person_profiles: "identified_only",
    persistence: "localStorage+cookie",
    opt_out_capturing_by_default: true, // gated on banner consent
  };
  posthog.init(POSTHOG_KEY, config);
}

export function trackEvent(event: string, props?: Props) {
  if (!ENABLED || !started) return;
  try {
    posthog.capture(`${EVENT_PREFIX}${event}`, props);
  } catch {
    // analytics must never break the app
  }
}

// ---- Consent controls (cookie banner) ------------------------------------

// Whether analytics is configured at all — the banner only shows when true.
export function analyticsEnabled(): boolean {
  return ENABLED;
}

// True once the visitor has explicitly accepted or rejected, so the banner
// isn't shown again on return visits.
//
// NOTE: we must NOT use has_opted_out_capturing() here. With
// opt_out_capturing_by_default (set in initAnalytics), a first-time visitor is
// already reported as "opted out" before making any choice, so that check would
// always be true and the banner would never appear. get_explicit_consent_status
// reads the *stored* choice only ("pending" until the visitor actually decides).
export function consentDecided(): boolean {
  return consentStatus() !== "pending";
}

// The visitor's stored choice: "granted" (accepted), "denied" (rejected), or
// "pending" (no choice yet). Used to show which option is active in the modal.
export function consentStatus(): "granted" | "denied" | "pending" {
  if (!ENABLED || !started) return "pending";
  try {
    return posthog.get_explicit_consent_status();
  } catch {
    return "pending";
  }
}

export function grantConsent() {
  if (!ENABLED || !started) return;
  try {
    posthog.opt_in_capturing();
  } catch {
    /* ignore */
  }
}

export function revokeConsent() {
  if (!ENABLED || !started) return;
  try {
    posthog.opt_out_capturing();
  } catch {
    /* ignore */
  }
}
