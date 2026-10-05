import {
  analyticsEnabled,
  consentDecided,
  consentStatus,
  grantConsent,
  initAnalytics,
  revokeConsent,
  trackEvent,
} from "../shared/analytics";
import {
  classifyFetchError,
  errorDetail,
  fetchPremierData,
  resolveVanityUrl,
  type PremierData,
} from "../shared/api";
import { fetchFaceitData, resolveFaceitNickname } from "../shared/faceit";
import { brandLogoSrc } from "../shared/brandLogo";
import {
  configToParams,
  parseLiveInput,
  settingsFingerprint,
  type LiveChannel,
} from "../shared/config";
import { downloadOverlayZip } from "../shared/export";
import { FONT_WEIGHTS, GOOGLE_FONTS, fontStack, loadFont } from "../shared/fonts";
import { renderMessage, renderWidget } from "../shared/render";
import {
  gitHubLogo,
  koFiLogo,
  kickMark,
  streamElementsLogo,
  twitchLogo,
  twitchMark,
  youTubeMark,
} from "../shared/socialLogos";
import { detectLinkPlatform, parseAccountInput, type AccountInput } from "../shared/steamId";
import {
  CORNER_RADII,
  DEFAULT_CONFIG,
  DEFAULT_STATS_BY_PROVIDER,
  PROVIDER_STATS,
  STAT_LABELS,
  STAT_MAX,
  type CornerRadius,
  type Provider,
  type StatKey,
  type WidgetConfig,
} from "../shared/types";
import { createPreviewAnimator } from "./previewMotion";
import "../widget/widget.css";
import "./customizer.css";

// External links for the header button row.
const REPO_URL = "https://github.com/sidkapahi/kapkit-cs2overlay";
const KOFI_URL = "https://ko-fi.com/kapahi";
const TWITCH_URL = "https://twitch.tv/kapowhi";

// ---- Inline icons (self-contained; no expiring remote assets) -------------
// The GitHub, Ko-fi, Twitch, and StreamElements marks are loaded from
// assets/logos/*.svg (see ../shared/socialLogos). Drop your own SVG into that
// folder to swap any of them out — no code change needed.
const ICON_GITHUB = gitHubLogo;
const ICON_KOFI = koFiLogo;
const ICON_TWITCH = twitchLogo;
const ICON_STREAMELEMENTS = streamElementsLogo;
// Radix icons from the sidebar design (Figma 182:3): caret for the font/weight
// dropdowns, globe for an empty link field, and the section reset arrow.
const ICON_CARET = `<svg viewBox="0 0 15 15" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M3.135 6.158a.5.5 0 0 1 .707-.023L7.5 9.565l3.658-3.43a.5.5 0 0 1 .684.73l-4 3.75a.5.5 0 0 1-.684 0l-4-3.75a.5.5 0 0 1-.023-.707Z"/></svg>`;
const ICON_GLOBE = `<svg viewBox="0 0 15 15" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.5 1.8a5.7 5.7 0 1 0 0 11.4 5.7 5.7 0 0 0 0-11.4ZM.9 7.5a6.6 6.6 0 1 1 13.2 0 6.6 6.6 0 0 1-13.2 0Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M13.5 7.9h-12v-.8h12v.8Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M7.1 13.5v-12h.8v12h-.8Zm3.275-6c0-2.173-.781-4.322-2.313-5.743l.476-.513C10.24 2.822 11.075 5.173 11.075 7.5c0 2.327-.835 4.678-2.537 6.257l-.476-.514c1.532-1.421 2.313-3.57 2.313-5.743ZM4 7.5c0-2.324.808-4.673 2.458-6.253l.484.506C5.458 3.173 4.7 5.324 4.7 7.5c0 2.176.758 4.327 2.242 5.747l-.484.506C4.808 12.173 4 9.824 4 7.5Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M7.5 3.958c2.17 0 4.375.401 5.87 1.236a.35.35 0 1 1-.34.611C11.679 5.052 9.608 4.658 7.5 4.658s-4.18.394-5.53 1.147a.35.35 0 1 1-.34-.61C3.124 4.358 5.33 3.957 7.5 3.957Zm0 6.892c2.17 0 4.375-.401 5.87-1.237a.35.35 0 1 0-.34-.61c-1.351.753-3.422 1.147-5.53 1.147s-4.18-.394-5.53-1.148a.35.35 0 1 0-.34.611c1.495.836 3.7 1.237 5.87 1.237Z"/></svg>`;
const ICON_RESET = `<svg viewBox="0 0 15 15" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M4.854 2.146a.5.5 0 0 1 0 .708L3.707 4H9a4.5 4.5 0 1 1 0 9H5a.5.5 0 0 1 0-1h4a3.5 3.5 0 1 0 0-7H3.707l1.147 1.146a.5.5 0 1 1-.708.708l-2-2a.5.5 0 0 1 0-.708l2-2a.5.5 0 0 1 .708 0Z"/></svg>`;
// Monochrome platform mark shown in the stream-link field once a channel is
// recognised, keyed by platform.
const LIVE_PLATFORM_MARKS: Record<string, string> = {
  twitch: twitchMark,
  youtube: youTubeMark,
  kick: kickMark,
};
// Phosphor "Copy" and "Check" (bold weight) — the copy button crossfades from
// one to the other when the URL is copied.
const ICON_COPY = `<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M216,28H88A12,12,0,0,0,76,40V76H40A12,12,0,0,0,28,88V216a12,12,0,0,0,12,12H168a12,12,0,0,0,12-12V180h36a12,12,0,0,0,12-12V40A12,12,0,0,0,216,28ZM156,204H52V100H156Zm48-48H180V88a12,12,0,0,0-12-12H100V52H204Z"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,0,1,17-17L96,183.51,215.51,63.51a12,12,0,0,1,17,17Z"/></svg>`;
const ICON_WARNING = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 16H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/></svg>`;

// Prompt shown in the preview before a Steam ID resolves. Both providers are
// keyed by the same Steam identity, so the input never changes — the PREMIER |
// FACEIT toggle only switches which data source is shown.
const PROMPT_TEXT = "ENTER YOUR STEAM OR FACEIT ACCOUNT";

let currentConfig: WidgetConfig = { ...DEFAULT_CONFIG, stats: [...DEFAULT_CONFIG.stats] };

// Analytics properties describing the setup someone landed on. `combo` is the
// whole configuration as one string, so a PostHog breakdown ranks the
// most popular combinations directly; the individual fields let you slice a
// single setting (e.g. how many people pick each font). No steamId here — the
// question is which *settings* are popular, not who chose them.
function configEventProps(
  config: WidgetConfig,
): Record<string, string | number | boolean> {
  return {
    combo: settingsFingerprint(config),
    font: config.font,
    fontWeight: config.fontWeight,
    stats: config.showStats ? config.stats.join(",") : "off",
    showBadge: config.showBadge,
    showMatchHistory: config.showMatchHistory,
    historyMode: config.historyMode,
    showWinLoss: config.showWinLoss,
    showChange: config.showChange,
    matchCount: config.matchCount,
    bgOpacity: config.bgOpacity,
    cornerRadius: config.cornerRadius,
    usesLive: Boolean(config.livePlatform),
    livePlatform: config.livePlatform,
  };
}
// Both providers' data for the current Steam ID, fetched together as soon as
// the account resolves, so flipping PREMIER | FACEIT shows cached data (and
// animates the change) instead of a fresh load. Cleared when the account changes.
type ProviderSlot =
  | { status: "loading" }
  | { status: "ok"; data: PremierData }
  | { status: "error"; error: unknown };
let slots: Partial<Record<Provider, ProviderSlot>> = {};
// Errors already reported to analytics for this account, so a provider the
// player has no account on is counted once, when it's first shown.
let trackedErrors = new Set<Provider>();
// Set while the Account input is being resolved to a Steam ID (vanity / FACEIT
// lookups), and the message when that fails.
let resolving = false;
let previewError: string | null = null;
// Bumped each time a fresh account load starts; with the Steam ID it keys the
// preview animator, so a new load plays the entrance but a provider switch
// morphs the card in place.
let loadGen = 0;
// The account load whose card is on screen ('' when it's a prompt or message).
let shownKey = "";
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastTrackedSteamId: string | null = null;
// Last live channel we counted, so adopting a channel fires one adoption event
// (not one per keystroke).
let lastTrackedLive = "";
// Which source drives the W/L pills: 'leetify' = rolling window (TOTAL),
// 'live' = per-stream session (STREAM). STREAM is only possible once a stream
// link is entered; entering one switches to it automatically.
let wlMode: "leetify" | "live" = "leetify";
// The stream link as typed, and the channel parsed from it (null if unusable).
// Kept apart from the config so picking TOTAL doesn't lose the link.
let liveRaw = "";
let liveParsed: LiveChannel | null = null;
// Whether the advanced options (W/L source, stat picker, history mode) are open.
let advancedOpen = false;
// Bumped on every new resolve so a slow vanity lookup that finishes after the
// user has typed something else can't overwrite the newer input's result.
let resolveToken = 0;

function getWidgetUrl(): string {
  const params = configToParams(currentConfig);
  const base =
    window.location.origin + window.location.pathname.replace(/\/$/, "");
  return `${base}/widget/?${params.toString()}`;
}

// Never render the widget larger than natural size in the preview; fitPreview
// only ever scales further *down* to fit the (responsive) preview panel.
const MAX_PREVIEW_SCALE = 1;

// Scales the rendered widget so it always fits inside the preview panel, however
// long the name or however much content is enabled — the panel flexes with the
// window and the widget shrinks to stay within it.
function fitPreview() {
  const area = document.getElementById("preview-widget");
  if (!area) return;
  const widget = area.querySelector<HTMLElement>(".widget");
  if (!widget) return;

  widget.style.transform = "scale(1)";
  const style = getComputedStyle(area);
  const availW =
    area.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight);
  const availH =
    area.clientHeight -
    parseFloat(style.paddingTop) -
    parseFloat(style.paddingBottom);

  const natW = widget.offsetWidth;
  const natH = widget.offsetHeight;
  if (natW === 0 || natH === 0) return;

  const scale = Math.min(MAX_PREVIEW_SCALE, availW / natW, availH / natH);
  widget.style.transform = `scale(${scale})`;
}

function promptCardHtml(text: string): string {
  return `<div class="preview-prompt">${text}</div>`;
}

// Animates preview changes: numbers roll, toggled features resize the card
// smoothly, and a newly loaded player plays the overlay's entrance.
const animatePreview = createPreviewAnimator();

function renderPreview() {
  const body = document.getElementById("preview-widget");
  const banner = document.getElementById("preview-banner");
  const bannerText = document.getElementById("preview-banner-text");
  if (!body || !banner || !bannerText) return;

  const slot = currentConfig.steamId ? slots[currentConfig.provider] : undefined;
  body.classList.remove("is-pending");
  const error =
    previewError ??
    (slot?.status === "error"
      ? slot.error instanceof Error
        ? slot.error.message
        : "Failed to load"
      : null);
  banner.hidden = !error;
  if (error) bannerText.textContent = error;

  const key = `${currentConfig.steamId}#${loadGen}`;
  if (slot?.status === "ok" && !error) {
    const html = renderWidget(currentConfig, slot.data);
    animatePreview(body, html, key, fitPreview);
    shownKey = key;
    return;
  }
  if (slot?.status === "loading" || (resolving && !error)) {
    // Switched to a provider whose data is still on its way: keep the card on
    // screen (dimmed) and morph it once the data lands, rather than flashing
    // a loading state. Only a first load shows "Loading".
    if (slot && shownKey === key && body.querySelector(".widget:not(.is-message)")) {
      body.classList.add("is-pending");
      return;
    }
    body.innerHTML = renderMessage("Loading", "…");
  } else {
    body.innerHTML = promptCardHtml(PROMPT_TEXT);
  }
  shownKey = "";
  fitPreview();
}

function updateGeneratedUrl() {
  const urlEl = document.getElementById("generated-url") as HTMLInputElement;
  const url = currentConfig.steamId ? getWidgetUrl() : "";
  urlEl.value = url;

  const zipBtn = document.getElementById("export-zip") as HTMLButtonElement | null;
  if (zipBtn) zipBtn.disabled = !url;
  // Dim the whole export bar until there's a real widget URL to hand off.
  const bar = document.getElementById("exportbar");
  if (bar) bar.classList.toggle("is-empty", !url);
}

// Turns whatever is in the Account box — a Steam64 ID, a Steam profile/vanity
// link, a bare word, a FACEIT profile link, or a FACEIT nickname — into a
// Steam64 ID (both providers key off it), then loads the preview.
async function resolveAndLoad(rawInput: string) {
  // A FACEIT link means a FACEIT overlay; a Steam link means Premier. Bare IDs
  // and names don't say which, so they leave the toggle as-is. Done before
  // taking a token so any preview reload setProvider kicks off is superseded.
  const platform = detectLinkPlatform(rawInput);
  if (platform) setProvider(platform === "faceit" ? "faceit" : "leetify", "auto");

  const token = ++resolveToken;
  const parsed = parseAccountInput(rawInput);

  if (parsed.kind === "empty") {
    currentConfig.steamId = "";
    slots = {};
    previewError = null;
    resolving = false;
    renderPreview();
    updateGeneratedUrl();
    return;
  }

  if (parsed.kind === "invalid") {
    currentConfig.steamId = "";
    slots = {};
    previewError = "Enter a Steam ID / profile link or a FACEIT link / username";
    resolving = false;
    renderPreview();
    updateGeneratedUrl();
    return;
  }

  // A plain Steam64 needs no lookup; every other form is a network round-trip.
  let steamId: string;
  if (parsed.kind === "id") {
    steamId = parsed.steamId;
  } else {
    resolving = true;
    previewError = null;
    renderPreview();
    try {
      steamId = await resolveAccountToSteamId(parsed);
    } catch (e) {
      if (token !== resolveToken) return; // superseded by newer input
      trackEvent("preview_error", {
        stage: "resolve",
        reason: classifyFetchError(e),
        detail: errorDetail(e),
        provider: currentConfig.provider,
      });
      previewError = e instanceof Error ? e.message : "Failed to resolve";
      slots = {};
      resolving = false;
      currentConfig.steamId = "";
      renderPreview();
      updateGeneratedUrl();
      return;
    }
    if (token !== resolveToken) return; // superseded by newer input
  }

  resolving = false;
  currentConfig.steamId = steamId;
  updateGeneratedUrl();
  await loadPreview(token);
}

// Resolves a non-Steam64 Account input to a Steam64 ID. A Steam vanity link
// goes through the Steam proxy; a FACEIT link/nickname through the FACEIT
// Worker. A bare word is ambiguous, so it tries the current provider's source
// first (FACEIT in FACEIT mode, Steam otherwise) and falls back to the other.
async function resolveAccountToSteamId(parsed: AccountInput): Promise<string> {
  switch (parsed.kind) {
    case "steamVanity":
      return resolveVanityUrl(parsed.vanity);
    case "faceit":
      return resolveFaceitNickname(parsed.nickname);
    case "ambiguous": {
      const word = parsed.token;
      const tryFaceit = () => resolveFaceitNickname(word);
      const trySteam = () => resolveVanityUrl(word);
      const [first, second] =
        currentConfig.provider === "faceit" ? [tryFaceit, trySteam] : [trySteam, tryFaceit];
      try {
        return await first();
      } catch {
        return second();
      }
    }
    default:
      throw new Error("Enter a Steam ID / profile link or a FACEIT link / username");
  }
}

// Fetches the account's Premier and FACEIT data together. Whichever matches the
// current toggle is shown as soon as it lands; the other waits in `slots` so a
// switch is instant. A player with no account on one side just gets that
// side's error banner when they switch to it.
async function loadPreview(token = ++resolveToken) {
  slots = {};
  trackedErrors = new Set();
  previewError = null;
  if (!currentConfig.steamId) {
    renderPreview();
    return;
  }

  loadGen++;
  const steamId = currentConfig.steamId;
  const fetchers: Record<Provider, () => Promise<PremierData>> = {
    leetify: () => fetchPremierData(steamId),
    // Fetch up to matchCount so toggling the stats block (which caps the strip
    // at 5) never needs a re-fetch; the widget itself fetches the exact 5/10
    // via faceitHistoryCount.
    faceit: () => fetchFaceitData(steamId, currentConfig.matchCount),
  };
  const providers = Object.keys(fetchers) as Provider[];
  for (const p of providers) slots[p] = { status: "loading" };
  renderPreview();

  await Promise.all(
    providers.map(async (p) => {
      let slot: ProviderSlot;
      try {
        slot = { status: "ok", data: await fetchers[p]() };
      } catch (e) {
        slot = { status: "error", error: e };
      }
      if (token !== resolveToken) return; // superseded by newer input
      slots[p] = slot;
      if (slot.status === "ok" && steamId !== lastTrackedSteamId) {
        // Just a funnel count — no Steam ID sent (we only want *that* someone
        // got this far, not *who*).
        trackEvent("steam_id_entered");
        lastTrackedSteamId = steamId;
      }
      if (p === currentConfig.provider) {
        trackShownError();
        renderPreview();
      }
    }),
  );
}

// Reports the current provider's load failure to analytics, once per account
// and provider, when it's actually shown (a background fetch for the other
// provider failing isn't an error the visitor saw).
function trackShownError() {
  const p = currentConfig.provider;
  const slot = slots[p];
  if (slot?.status !== "error" || trackedErrors.has(p)) return;
  trackedErrors.add(p);
  trackEvent("preview_error", {
    stage: "stats",
    reason: classifyFetchError(slot.error),
    detail: errorDetail(slot.error),
    provider: p,
  });
}

function debouncedLoadPreview(rawInput: string) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => resolveAndLoad(rawInput), 600);
}

// Switches the active data source. The Steam identity and its input stay put —
// only the stat trio/pills, the provider-specific Design rows, and the preview's
// data source change. Both providers' data is already loaded (or loading) for
// the current Steam ID, so the preview morphs to the other one in place.
// `source` is "auto" when a pasted FACEIT/Steam link flipped it.
function setProvider(provider: Provider, source: "manual" | "auto" = "manual") {
  if (currentConfig.provider === provider) return;
  currentConfig.provider = provider;
  currentConfig.stats = [...DEFAULT_STATS_BY_PROVIDER[provider]];

  const pills = document.getElementById("stats-pills");
  if (pills) pills.innerHTML = statPillsHtml();
  syncStatsUi();
  syncProviderToggle();
  syncProviderRows();

  if (currentConfig.steamId && !slots[provider]) loadPreview();
  else {
    trackShownError();
    renderPreview();
  }
  updateGeneratedUrl();
  trackEvent("provider_selected", { provider, source });
}

function syncProviderToggle() {
  const row = document.getElementById("provider-toggle");
  if (!row) return;
  for (const seg of row.querySelectorAll<HTMLButtonElement>(".seg")) {
    seg.classList.toggle("selected", seg.dataset.provider === currentConfig.provider);
  }
}

// Swaps the provider-specific Data toggles: FACEIT gets Flag (its dial is
// always shown, so no Styled Rank); Premier gets Styled Rank (no Flag).
function syncProviderRows() {
  const faceit = currentConfig.provider === "faceit";
  const set = (id: string, hidden: boolean) => {
    const el = document.getElementById(id);
    if (el) el.hidden = hidden;
  };
  set("flag-row", !faceit);
  set("badge-row", faceit);
  syncHistoryModeUi();
}

// ---- Sidebar scroll fades ------------------------------------------------
// Shows the top/bottom fade only while the scrolling body has hidden content in
// that direction, so nothing is faded at rest or on mobile (where the body
// doesn't scroll).
function syncScrollFades() {
  const setup = document.querySelector<HTMLElement>(".setup");
  const body = document.querySelector<HTMLElement>(".setup-body");
  if (!setup || !body) return;
  const maxScroll = body.scrollHeight - body.clientHeight;
  setup.classList.toggle("fade-top", body.scrollTop > 1);
  setup.classList.toggle("fade-bottom", body.scrollTop < maxScroll - 1);
}

function bindScrollFades() {
  const body = document.querySelector<HTMLElement>(".setup-body")!;
  body.addEventListener("scroll", syncScrollFades, { passive: true });
  // Re-check when the viewport or any section's height changes (advanced panel,
  // provider rows, window resize).
  const ro = new ResizeObserver(syncScrollFades);
  ro.observe(body);
  for (const child of body.children) ro.observe(child);
  syncScrollFades();
}

// ---- Show / close advanced -----------------------------------------------
function syncAdvancedUi() {
  const panel = document.getElementById("advanced")!;
  const btn = document.getElementById("advanced-toggle")!;
  panel.hidden = !advancedOpen;
  btn.textContent = advancedOpen ? "CLOSE ADVANCED" : "SHOW ADVANCED";
  btn.setAttribute("aria-expanded", String(advancedOpen));
}

// ---- Match history mode (W/L letters vs per-match ELO) --------------------
// FACEIT only — Premier has no per-match rating change to show. Dimmed while
// Match History itself is off.
function syncHistoryModeUi() {
  const row = document.getElementById("history-mode-row");
  if (!row) return;
  row.hidden = currentConfig.provider !== "faceit";
  const on = currentConfig.showMatchHistory;
  for (const seg of row.querySelectorAll<HTMLButtonElement>(".seg")) {
    seg.classList.toggle("selected", seg.dataset.hist === currentConfig.historyMode);
    seg.disabled = !on;
  }
}

function bindHistoryMode() {
  document.getElementById("show-history")!.addEventListener("change", syncHistoryModeUi);
  document.getElementById("history-mode")!.addEventListener("click", (e) => {
    const seg = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg");
    if (!seg || seg.disabled) return;
    currentConfig.historyMode = seg.dataset.hist === "elo" ? "elo" : "wl";
    syncHistoryModeUi();
    renderPreview();
    updateGeneratedUrl();
  });
}

// Simple display toggles → config keys. Stats and win/loss gate nested controls,
// so they're bound separately.
const checkboxMap: Record<string, keyof WidgetConfig> = {
  "show-flag": "showFlag",
  "show-name": "showName",
  "show-change": "showChange",
  "show-history": "showMatchHistory",
  "show-badge": "showBadge",
};

// ---- Stats picker (pill grid) --------------------------------------------
function syncStatsUi() {
  const on = currentConfig.showStats;
  const row = document.getElementById("stats-pills")!;
  row.classList.toggle("is-off", !on);
  const atMax = currentConfig.stats.length >= STAT_MAX;
  for (const btn of row.querySelectorAll<HTMLButtonElement>(".pill")) {
    const key = btn.dataset.stat as StatKey;
    const selected = currentConfig.stats.includes(key);
    btn.classList.toggle("selected", selected);
    // Disable when the block is off, or when the cap is hit and this one isn't
    // already selected (so you must deselect before picking another).
    btn.disabled = !on || (atMax && !selected);
  }
}

function bindStats() {
  const showStats = document.getElementById("show-stats") as HTMLInputElement;
  showStats.checked = currentConfig.showStats;
  showStats.addEventListener("change", () => {
    currentConfig.showStats = showStats.checked;
    syncStatsUi();
    renderPreview();
    updateGeneratedUrl();
  });

  const row = document.getElementById("stats-pills")!;
  row.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".pill");
    if (!btn || btn.disabled) return;
    const key = btn.dataset.stat as StatKey;
    if (currentConfig.stats.includes(key)) {
      currentConfig.stats = currentConfig.stats.filter((k) => k !== key);
    } else {
      if (currentConfig.stats.length >= STAT_MAX) return; // cap enforced
      // Insert keeping the provider's stat order.
      currentConfig.stats = PROVIDER_STATS[currentConfig.provider].filter(
        (k) => currentConfig.stats.includes(k) || k === key,
      );
    }
    syncStatsUi();
    renderPreview();
    updateGeneratedUrl();
  });
}

// ---- Stream link + Win/Loss source (STREAM vs TOTAL) ----------------------
// The config only carries a live channel while W/L is set to STREAM, so the
// overlay tracks the session only when the streamer asked for it.
function applyLive() {
  const live = wlMode === "live" ? liveParsed : null;
  currentConfig.livePlatform = live?.platform ?? "";
  currentConfig.liveChannel = live?.channel ?? "";
}

function syncWlUi() {
  const on = currentConfig.showWinLoss;
  const row = document.getElementById("wl-mode")!;
  for (const seg of row.querySelectorAll<HTMLButtonElement>(".seg")) {
    seg.classList.toggle("selected", seg.dataset.mode === wlMode);
    seg.disabled = !on;
    // STREAM needs a stream link first; clicking it without one jumps to the
    // field instead (see bindWl), so it only looks unavailable.
    if (seg.dataset.mode === "live") seg.classList.toggle("unavailable", !liveParsed);
  }
  renderLiveIcon();
}

// The stream-link field's icon: a globe until a channel is recognised, then
// that platform's mark.
function renderLiveIcon() {
  const icon = document.getElementById("live-icon")!;
  const mark = liveParsed ? LIVE_PLATFORM_MARKS[liveParsed.platform] : undefined;
  icon.innerHTML = mark ?? ICON_GLOBE;
  icon.classList.toggle("is-set", !!mark);
}

// Fires one `live_selected` event the first time a valid channel is adopted (and
// again if it's changed to a different one), tagged with the platform and the
// channel (a public handle) so you can see which channels use it.
function trackLiveSelected() {
  const key = `${currentConfig.livePlatform}:${currentConfig.liveChannel}`;
  if (currentConfig.liveChannel && key !== lastTrackedLive) {
    lastTrackedLive = key;
    trackEvent("live_selected", {
      platform: currentConfig.livePlatform,
      channel: currentConfig.liveChannel,
    });
  }
}

function bindWl() {
  const showWl = document.getElementById("show-wl") as HTMLInputElement;
  showWl.checked = currentConfig.showWinLoss;
  showWl.addEventListener("change", () => {
    currentConfig.showWinLoss = showWl.checked;
    syncWlUi();
    renderPreview();
    updateGeneratedUrl();
  });

  const liveField = document.getElementById("live-channel") as HTMLInputElement;

  document.getElementById("wl-mode")!.addEventListener("click", (e) => {
    const seg = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg");
    if (!seg || seg.disabled) return;
    if (seg.dataset.mode === "live" && !liveParsed) {
      liveField.focus();
      return;
    }
    wlMode = seg.dataset.mode === "live" ? "live" : "leetify";
    applyLive();
    trackLiveSelected();
    syncWlUi();
    updateGeneratedUrl();
  });

  // While focused, the field shows the link as typed; once it loses focus with a
  // recognised channel it shows just the channel name next to the platform mark.
  liveField.addEventListener("focus", () => {
    liveField.value = liveRaw;
  });
  liveField.addEventListener("input", () => {
    liveRaw = liveField.value;
    const hadChannel = !!liveParsed;
    liveParsed = parseLiveInput(liveRaw);
    // A stream link switches W/L to STREAM the moment one is recognised, and
    // clearing it falls back to TOTAL. Picking TOTAL by hand sticks while the
    // link is edited.
    if (liveParsed && !hadChannel) wlMode = "live";
    if (!liveParsed) wlMode = "leetify";
    // Update the preview/URL live as they type, but don't track yet: every
    // keystroke of a bare login is itself a "valid" channel, so tracking here
    // fires a live_selected per character. Tracking happens on commit (blur).
    applyLive();
    syncWlUi();
    updateGeneratedUrl();
  });
  liveField.addEventListener("blur", () => {
    liveField.value = liveParsed ? liveParsed.channel : liveRaw;
    // Commit point: the user has finished typing (blurred or pressed Enter, which
    // blurs). Track the final channel here so we get one event per real channel
    // rather than one per keystroke.
    trackLiveSelected();
  });
  liveField.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      liveField.blur();
    }
  });
}

// ---- Section resets --------------------------------------------------------
// Each section header's reset arrow puts just that section back to defaults.
function resetSection(section: string) {
  const d = DEFAULT_CONFIG;
  if (section === "data") {
    currentConfig.showFlag = d.showFlag;
    currentConfig.showName = d.showName;
    currentConfig.showBadge = d.showBadge;
    currentConfig.showWinLoss = d.showWinLoss;
    currentConfig.showStats = d.showStats;
    currentConfig.showChange = d.showChange;
    currentConfig.showMatchHistory = d.showMatchHistory;
    currentConfig.historyMode = d.historyMode;
    currentConfig.stats = [...DEFAULT_STATS_BY_PROVIDER[currentConfig.provider]];
    wlMode = liveParsed ? "live" : "leetify";
    applyLive();
  } else if (section === "background") {
    currentConfig.bgColor = d.bgColor;
    currentConfig.bgOpacity = d.bgOpacity;
    currentConfig.cornerRadius = d.cornerRadius;
  } else if (section === "text") {
    currentConfig.font = d.font;
    currentConfig.fontWeight = d.fontWeight;
  } else {
    return;
  }
  syncControlsFromConfig();
  renderPreview();
  updateGeneratedUrl();
}

// ---- Font combobox -------------------------------------------------------
function renderFontList(filter: string) {
  const list = document.getElementById("font-list")!;
  const q = filter.trim().toLowerCase();
  const matches = GOOGLE_FONTS.filter((f) => f.toLowerCase().includes(q));
  list.innerHTML = matches
    .map(
      (f) =>
        `<div class="combo-item${
          f === currentConfig.font ? " selected" : ""
        }" data-font="${f}" style="font-family:${fontStack(f)}">${f}</div>`,
    )
    .join("");
  // Preload the fonts shown so the list previews in their own typeface.
  for (const f of matches.slice(0, 40)) loadFont(f);
}

function bindFont() {
  const search = document.getElementById("font-search") as HTMLInputElement;
  const list = document.getElementById("font-list")!;

  const open = () => {
    renderFontList("");
    list.hidden = false;
  };
  const close = () => {
    list.hidden = true;
    search.value = currentConfig.font;
    search.style.fontFamily = fontStack(currentConfig.font);
  };

  search.addEventListener("focus", () => {
    search.value = "";
    open();
  });
  search.addEventListener("input", () => renderFontList(search.value));
  search.addEventListener("blur", () => {
    // Delay so a click on an item registers before the list hides.
    setTimeout(close, 150);
  });

  list.addEventListener("mousedown", (e) => {
    const item = (e.target as HTMLElement).closest(".combo-item");
    if (!item) return;
    e.preventDefault();
    const font = (item as HTMLElement).dataset.font!;
    currentConfig.font = font;
    loadFont(font, currentConfig.fontWeight);
    close();
    renderPreview();
    updateGeneratedUrl();
  });
}

// ---- Font weight select --------------------------------------------------
function bindWeight() {
  const sel = document.getElementById("font-weight") as HTMLSelectElement;
  sel.value = String(currentConfig.fontWeight);
  sel.addEventListener("change", () => {
    currentConfig.fontWeight = parseInt(sel.value, 10);
    loadFont(currentConfig.font, currentConfig.fontWeight);
    renderPreview();
    updateGeneratedUrl();
  });
}

// ---- Background color + opacity -----------------------------------------
// The hex field shows the colour without its '#', and the opacity field a bare
// number with a static '%' suffix beside it.
function bindBackground() {
  const color = document.getElementById("bg-color") as HTMLInputElement;
  const hex = document.getElementById("bg-hex") as HTMLInputElement;
  const opacity = document.getElementById("bg-opacity") as HTMLInputElement;

  const applyColor = (value: string, fromHex = false) => {
    currentConfig.bgColor = value;
    color.value = value;
    if (!fromHex) hex.value = value.slice(1);
    renderPreview();
    updateGeneratedUrl();
  };

  color.addEventListener("input", () => applyColor(color.value));

  hex.addEventListener("input", () => {
    const v = hex.value.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}$/.test(v)) applyColor(`#${v.toLowerCase()}`, true);
  });
  hex.addEventListener("blur", () => {
    hex.value = currentConfig.bgColor.slice(1);
  });

  opacity.addEventListener("input", () => {
    const digits = opacity.value.replace(/[^\d]/g, "");
    currentConfig.bgOpacity = Math.max(0, Math.min(100, parseInt(digits || "0", 10)));
    renderPreview();
    updateGeneratedUrl();
  });
  opacity.addEventListener("blur", () => {
    opacity.value = String(currentConfig.bgOpacity);
  });
}

// ---- Corner radius segmented toggle --------------------------------------
function syncCornerRadius() {
  const row = document.getElementById("corner-radius")!;
  for (const seg of row.querySelectorAll<HTMLButtonElement>(".seg")) {
    seg.classList.toggle("selected", Number(seg.dataset.radius) === currentConfig.cornerRadius);
  }
}

// Elements whose corners change with the radius preset.
const RADIUS_MORPH_SELECTORS = [".widget"];
const RADIUS_MORPH_MS = 468;

// The radius an element actually renders with. The pill preset is 9999px, which
// the browser clamps to half the box — animating to/from 9999 would snap, so we
// work in the clamped value.
function effectiveRadius(el: HTMLElement): number {
  const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  return Math.min(r, el.offsetHeight / 2, el.offsetWidth / 2);
}

// The preview is re-rendered wholesale, so a CSS transition never sees the old
// value. Carry it across instead: start each new element at the radius its
// predecessor had, then transition to the new one.
function morphPreviewRadius(update: () => void) {
  const body = document.getElementById("preview-widget");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!body || reduced) return update();

  const before = RADIUS_MORPH_SELECTORS.map((sel) =>
    [...body.querySelectorAll<HTMLElement>(sel)].map(effectiveRadius),
  );
  update();

  RADIUS_MORPH_SELECTORS.forEach((sel, i) => {
    body.querySelectorAll<HTMLElement>(sel).forEach((el, j) => {
      const from = before[i][j];
      const to = effectiveRadius(el);
      if (from === undefined || from === to) return;
      el.style.borderRadius = `${from}px`;
      void el.offsetWidth; // commit the start value before transitioning
      el.style.transition = `border-radius ${RADIUS_MORPH_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
      el.style.borderRadius = `${to}px`;
      // Hand control back to the stylesheet once settled.
      // (transitionend bubbles, so ignore the chips' events reaching the shell.)
      const settle = (e: TransitionEvent) => {
        if (e.target !== el) return;
        el.removeEventListener("transitionend", settle);
        el.style.transition = "";
        el.style.borderRadius = "";
      };
      el.addEventListener("transitionend", settle);
    });
  });
}

function bindCornerRadius() {
  const row = document.getElementById("corner-radius")!;
  row.addEventListener("click", (e) => {
    const seg = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg");
    if (!seg) return;
    currentConfig.cornerRadius = Number(seg.dataset.radius) as CornerRadius;
    syncCornerRadius();
    morphPreviewRadius(renderPreview);
    updateGeneratedUrl();
  });
}

// Pushes currentConfig into every control (used on init and section resets).
function syncControlsFromConfig() {
  for (const [id, key] of Object.entries(checkboxMap)) {
    (document.getElementById(id) as HTMLInputElement).checked = currentConfig[
      key
    ] as boolean;
  }

  (document.getElementById("show-stats") as HTMLInputElement).checked =
    currentConfig.showStats;
  const pills = document.getElementById("stats-pills");
  if (pills) pills.innerHTML = statPillsHtml();
  syncStatsUi();

  (document.getElementById("show-wl") as HTMLInputElement).checked =
    currentConfig.showWinLoss;
  if (currentConfig.livePlatform) wlMode = "live";
  syncWlUi();

  const search = document.getElementById("font-search") as HTMLInputElement;
  search.value = currentConfig.font;
  search.style.fontFamily = fontStack(currentConfig.font);
  loadFont(currentConfig.font, currentConfig.fontWeight);
  (document.getElementById("font-weight") as HTMLSelectElement).value = String(
    currentConfig.fontWeight,
  );

  (document.getElementById("bg-color") as HTMLInputElement).value =
    currentConfig.bgColor;
  (document.getElementById("bg-hex") as HTMLInputElement).value =
    currentConfig.bgColor.slice(1);
  (document.getElementById("bg-opacity") as HTMLInputElement).value = String(
    currentConfig.bgOpacity,
  );
  syncCornerRadius();

  // Provider toggle + the provider-specific Data toggles (Flag vs Styled Rank).
  syncProviderToggle();
  syncProviderRows();
  syncAdvancedUi();
}

function bindControls() {
  const steamInput = document.getElementById("steam-id") as HTMLInputElement;
  steamInput.addEventListener("input", () => {
    // The raw input may be a URL or vanity name, not a Steam64 ID yet, so clear
    // the generated URL until resolveAndLoad has a real Steam64 ID to put in it.
    // Both providers resolve the same way — only the data source differs.
    currentConfig.steamId = "";
    updateGeneratedUrl();
    debouncedLoadPreview(steamInput.value);
  });

  document.getElementById("provider-toggle")!.addEventListener("click", (e) => {
    const seg = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg");
    if (!seg) return;
    setProvider(seg.dataset.provider === "faceit" ? "faceit" : "leetify");
  });

  for (const [id, key] of Object.entries(checkboxMap)) {
    const el = document.getElementById(id) as HTMLInputElement;
    el.checked = currentConfig[key] as boolean;
    el.addEventListener("change", () => {
      (currentConfig as unknown as Record<string, boolean>)[key] = el.checked;
      renderPreview();
      updateGeneratedUrl();
    });
  }

  bindStats();
  bindWl();
  bindHistoryMode();
  bindFont();
  bindWeight();
  bindBackground();
  bindCornerRadius();

  document.getElementById("advanced-toggle")!.addEventListener("click", () => {
    advancedOpen = !advancedOpen;
    syncAdvancedUi();
  });

  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-reset]")) {
    btn.addEventListener("click", () => resetSection(btn.dataset.reset ?? ""));
  }

  // Outbound header links (GitHub / Ko-fi / Twitch). One delegated listener
  // reads data-link so a single social_click event, broken down by `target`,
  // covers all three. They open in a new tab, so the page stays put and the
  // event has time to send.
  document.querySelector(".link-row")?.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("[data-link]");
    if (link) trackEvent("social_click", { target: link.dataset.link ?? "unknown" });
  });

  document.getElementById("copy-url")!.addEventListener("click", () => {
    const urlEl = document.getElementById("generated-url") as HTMLInputElement;
    // Ignore repeat clicks while the "Link Copied!" confirmation is showing so
    // we don't capture that placeholder as the URL to restore.
    if (urlEl.value && urlEl.dataset.copiedRestore === undefined) {
      navigator.clipboard.writeText(urlEl.value);
      trackEvent("widget_url_copied", configEventProps(currentConfig));
      const box = document.getElementById("copy-url")!.closest(".url-box")!;
      box.classList.add("copied");
      // Swap the icon to a check mark and the URL text to a confirmation, then
      // restore both after a short beat.
      urlEl.dataset.copiedRestore = urlEl.value;
      urlEl.value = "Link Copied!";
      setTimeout(() => {
        box.classList.remove("copied");
        if (urlEl.dataset.copiedRestore !== undefined) {
          urlEl.value = urlEl.dataset.copiedRestore;
          delete urlEl.dataset.copiedRestore;
        }
      }, 1500);
    }
  });

  const zipBtn = document.getElementById("export-zip")!;
  zipBtn.addEventListener("click", () => {
    if (!currentConfig.steamId) return;
    downloadOverlayZip(currentConfig, getWidgetUrl());
    trackEvent("export_zip_downloaded", configEventProps(currentConfig));
    const label = zipBtn.querySelector(".zip-label");
    if (label) {
      const original = label.textContent;
      label.textContent = "DOWNLOADED ✓";
      setTimeout(() => (label.textContent = original), 1600);
    }
  });
}

// Pill labels use the compact, spaceless forms from the design (Figma 29:674)
// so they fit a grid cell on one line; the overlay keeps its own STAT_LABELS.
const PILL_LABEL: Partial<Record<StatKey, string>> = { winpct: "WIN%", hs: "HS%" };

function statPillsHtml(): string {
  return PROVIDER_STATS[currentConfig.provider]
    .map(
      (key) =>
        `<button type="button" class="pill" data-stat="${key}">${PILL_LABEL[key] ?? STAT_LABELS[key]}</button>`,
    )
    .join("");
}

function weightOptionsHtml(): string {
  return FONT_WEIGHTS.map(
    (w) => `<option value="${w.value}">${w.label}</option>`,
  ).join("");
}

// Cookie consent banner + Privacy & Cookies modal. Analytics starts opted out
// (see initAnalytics) and stays that way until the visitor explicitly clicks
// Accept or Reject — nothing else counts as consent, so the banner remains
// until they choose. The banner is a card pinned to the bottom of the setup
// sidebar. The overlay is cookieless and shows none of this.
function mountConsentUi() {
  if (!analyticsEnabled()) return; // no analytics configured → nothing to consent to

  // The modal is an overlay, so it lives on <body>.
  const root = document.createElement("div");
  root.className = "consent-root";
  root.innerHTML = `
    <div class="modal-overlay" id="privacy-overlay" hidden>
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="privacy-title">
        <div class="modal-head">
          <h2 id="privacy-title" class="modal-title">Privacy &amp; Cookies</h2>
          <button type="button" class="modal-close" id="privacy-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <p class="modal-updated">Last updated: 2026-09-28</p>
          <p>kapKit's CS2 overlay customizer uses <strong>PostHog</strong>, a privacy-friendly analytics service, to understand how the tool is used so it can be improved. We keep this to a minimum and never sell your data.</p>

          <h3>What we collect on the customizer</h3>
          <p>Anonymous usage events only:</p>
          <ul>
            <li>Pages viewed, and where you arrived from (referrer / UTM tags)</li>
            <li>That a Steam ID was entered — <strong>not the ID itself</strong></li>
            <li>The live channel you enter (a public Twitch, YouTube, or Kick handle) and which platform it is, if you use a live session</li>
            <li>Which widget settings you build (fonts, stats, colors, and so on)</li>
            <li>When you copy the widget URL or export the ZIP</li>
            <li>Clicks on the GitHub, Ko-fi, and Twitch links</li>
            <li>Errors, so broken states can be found and fixed</li>
          </ul>

          <h3>What we do NOT collect</h3>
          <ul>
            <li>Your Steam ID is never attached to analytics</li>
            <li>No session recording, no keystrokes, no personal profiles</li>
            <li>We don't sell or share your data</li>
          </ul>

          <h3>Live-session status checks</h3>
          <p>If you set a live session, the overlay checks whether your channel is streaming by asking the matching platform — <strong>Twitch</strong>, <strong>YouTube</strong>, or <strong>Kick</strong> — through a small proxy service. Only your <strong>public channel handle</strong> is sent (never your Steam ID), and the proxy shields your viewers' IP addresses from the platform. The YouTube check uses <strong>YouTube API Services</strong>; by using it you're also subject to the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">YouTube Terms of Service</a>, and Google's handling of any data is covered by the <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google Privacy Policy</a>.</p>

          <h3>The overlay is cookieless</h3>
          <p>The OBS overlay itself sets <strong>no cookies</strong> and stores nothing on your machine for analytics. It sends only anonymous counts (that it loaded, that a stream went live, a periodic "still live" ping while you stream, and errors), so it needs no consent and shows no banner on stream. If you set a live session, the go-live and "still live" events include your <strong>public channel handle</strong> and platform, so we can see which streams are using the overlay; your Steam ID is never included.</p>

          <h3>Cookies &amp; your choice</h3>
          <p>On this customizer, analytics uses first-party cookies to recognise return visits. You choose whether to allow them — rejecting means no analytics cookies are set. You can change your mind any time right here:</p>
          <div class="cookie-actions modal-consent">
            <span class="consent-state" id="consent-state"></span>
            <button type="button" class="cookie-btn cookie-reject" id="modal-reject">Reject</button>
            <button type="button" class="cookie-btn cookie-accept" id="modal-accept">Accept</button>
          </div>

          <h3>Questions?</h3>
          <p>Reach out any time at <a class="modal-mail" href="mailto:hey@sidkapahi.com">hey@sidkapahi.com</a>.</p>

          <p class="modal-fine">Analytics is processed by PostHog on our behalf. This notice is provided in good faith and isn't legal advice.</p>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // The banner is a small card pinned to the bottom of the setup sidebar.
  const banner = document.createElement("div");
  banner.className = "cookie-banner";
  banner.hidden = true;
  banner.setAttribute("role", "region");
  banner.setAttribute("aria-label", "Cookie consent");
  banner.innerHTML = `
    <img class="cookie-logo" src="${brandLogoSrc}" alt="kapKit">
    <div class="cookie-copy">
      <p class="cookie-title">Delicious Cookies</p>
      <p class="cookie-text">We use privacy-friendly analytics to help improve CS2 Stats Overlay and its features.</p>
    </div>
    <button type="button" class="cookie-privacy" id="cookie-privacy">Privacy Policy</button>
    <div class="cookie-actions">
      <button type="button" class="cookie-btn cookie-reject" id="cookie-reject">No thanks</button>
      <button type="button" class="cookie-btn cookie-accept" id="cookie-accept">Allow</button>
    </div>
  `;
  document.body.appendChild(banner);

  const overlay = root.querySelector<HTMLElement>("#privacy-overlay")!;
  const stateEl = root.querySelector<HTMLElement>("#consent-state")!;
  const modalAccept = root.querySelector<HTMLElement>("#modal-accept")!;
  const modalReject = root.querySelector<HTMLElement>("#modal-reject")!;

  // Reflect the saved choice: label it in the status line and mark the active
  // button (aria-pressed + .is-active) so it's clear which option is selected.
  const refreshState = () => {
    const status = consentStatus();
    stateEl.textContent =
      status === "granted"
        ? "You've allowed analytics cookies."
        : status === "denied"
          ? "You've rejected analytics cookies."
          : "No choice made yet.";
    const accepted = status === "granted";
    const rejected = status === "denied";
    modalAccept.classList.toggle("is-active", accepted);
    modalReject.classList.toggle("is-active", rejected);
    modalAccept.setAttribute("aria-pressed", String(accepted));
    modalReject.setAttribute("aria-pressed", String(rejected));
  };
  const openModal = () => {
    refreshState();
    overlay.hidden = false;
  };
  const closeModal = () => {
    overlay.hidden = true;
  };

  // Applies a choice and hides the banner. The choice is only ever made by
  // explicitly clicking Accept or Reject — nothing else counts as consent, so
  // the banner stays until the visitor decides.
  function decide(accepted: boolean) {
    if (accepted) grantConsent();
    else revokeConsent();
    banner.hidden = true;
    refreshState();
  }

  banner.querySelector("#cookie-accept")!.addEventListener("click", () => decide(true));
  banner.querySelector("#cookie-reject")!.addEventListener("click", () => decide(false));
  banner.querySelector("#cookie-privacy")!.addEventListener("click", openModal);
  modalAccept.addEventListener("click", () => decide(true));
  modalReject.addEventListener("click", () => decide(false));
  root.querySelector("#privacy-close")!.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.getElementById("open-privacy")?.addEventListener("click", openModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // Show the banner until an explicit choice is made (nothing on return visits).
  if (!consentDecided()) banner.hidden = false;
}

// Terms of Service modal. Unlike the privacy modal this has nothing to do with
// analytics, so it always mounts — the "Terms of Service" footer link opens it.
function mountTos() {
  const root = document.createElement("div");
  root.className = "tos-root";
  root.innerHTML = `
    <div class="modal-overlay" id="tos-overlay" hidden>
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="tos-title">
        <div class="modal-head">
          <h2 id="tos-title" class="modal-title">Terms of Service</h2>
          <button type="button" class="modal-close" id="tos-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <p class="modal-updated">Last updated: 2026-08-26</p>

          <h3>The short version</h3>
          <p>CS2 Stats Overlay is free, open source software provided as is under the MIT License. By using it, you agree to these terms and to the terms of the platforms you connect it to. There are no accounts, no subscriptions, and no fees.</p>

          <h3>Acceptance</h3>
          <p>These terms are a legal agreement between you and the CS2 Stats Overlay project ("CS2 Stats Overlay", "we") covering the customizer published at <a href="https://cs2widget.kapkit.ca/" target="_blank" rel="noopener">cs2widget.kapkit.ca</a>, the OBS overlay it generates, and the source published at <a href="https://github.com/sidkapahi/cs2-stats-overlay" target="_blank" rel="noopener">github.com/sidkapahi/cs2-stats-overlay</a>. By using CS2 Stats Overlay, you accept these terms. If you do not agree, do not use it.</p>

          <h3>The software and your license</h3>
          <p>CS2 Stats Overlay is released under the <a href="https://github.com/sidkapahi/cs2-stats-overlay/blob/main/LICENSE" target="_blank" rel="noopener">MIT License</a>. That license governs your right to use, copy, modify, and distribute the software, and it prevails if anything here appears to conflict with it. You may run CS2 Stats Overlay for personal or commercial streaming at no cost.</p>

          <h3>Stats and connected platforms are your responsibility</h3>
          <p>CS2 Stats Overlay reads your public CS2 stats from <a href="https://leetify.com" target="_blank" rel="noopener">Leetify</a> using the Steam profile you point it at, and it can check whether a channel you enter is live on Twitch, YouTube, or Kick. You are responsible for using those services within their own terms and for having the rights to the accounts and profile you connect:</p>
          <ul>
            <li><a href="https://leetify.com/terms-of-service" target="_blank" rel="noopener">Leetify Terms of Service</a></li>
            <li><a href="https://www.twitch.tv/p/legal/terms-of-service/" target="_blank" rel="noopener">Twitch Terms of Service</a></li>
            <li><a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">YouTube Terms of Service</a> and the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">Google API Services User Data Policy</a></li>
            <li><a href="https://kick.com/terms-of-service" target="_blank" rel="noopener">Kick Terms of Service</a></li>
          </ul>
          <p>CS2 Stats Overlay is an independent project and is not affiliated with, endorsed by, or sponsored by Valve, Steam, Leetify, Twitch, YouTube, Google, Kick, or OBS. All product names and logos are the property of their respective owners.</p>

          <h3>Acceptable use</h3>
          <p>Use CS2 Stats Overlay lawfully and only with accounts and profiles you are entitled to access. Do not use it to violate any platform's terms, to misrepresent data, or to interfere with the services it connects to. You are responsible for how you display and use the stats it produces on your stream.</p>

          <h3>No warranty</h3>
          <p>CS2 Stats Overlay is provided "as is" and "as available", without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the overlay will be uninterrupted, error free, or that stats and live status will always be accurate or available, since they depend on third-party services outside our control.</p>

          <h3>Limitation of liability</h3>
          <p>To the maximum extent permitted by law, in no event shall the authors or copyright holders be liable for any claim, damages, or other liability, whether in an action of contract, tort, or otherwise, arising from, out of, or in connection with CS2 Stats Overlay or the use of or other dealings in it. Because the tool is free, you assume responsibility for how you use it.</p>

          <h3>Privacy</h3>
          <p>How the customizer handles data is described in the <a href="#" id="tos-privacy-link">Privacy &amp; Cookies</a> notice, which is part of these terms.</p>

          <h3>Changes to these terms</h3>
          <p>These terms may be updated as the tool evolves. The current version is always posted here with the "last updated" date above. Continuing to use CS2 Stats Overlay after a change means you accept the revised terms.</p>

          <h3>Contact</h3>
          <p>Questions about these terms? Email <a class="modal-mail" href="mailto:hey@sidkapahi.com">hey@sidkapahi.com</a>, or open an issue on <a href="https://github.com/sidkapahi/cs2-stats-overlay/issues" target="_blank" rel="noopener">GitHub</a>.</p>

          <p class="modal-fine">This notice is provided in good faith and isn't legal advice.</p>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const overlay = root.querySelector<HTMLElement>("#tos-overlay")!;
  const open = () => { overlay.hidden = false; };
  const close = () => { overlay.hidden = true; };

  document.getElementById("open-tos")?.addEventListener("click", open);
  root.querySelector("#tos-close")!.addEventListener("click", close);
  root.querySelector("#tos-privacy-link")!.addEventListener("click", (e) => {
    e.preventDefault();
    close();
    document.getElementById("open-privacy")?.dispatchEvent(new MouseEvent("click"));
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

function init() {
  // Customizer analytics: cookie-based, but starts opted out — nothing is
  // captured until the visitor accepts via the consent banner (mounted below).
  initAnalytics();

  const app = document.getElementById("app")!;
  app.innerHTML = `
    <div class="shell">
      <aside class="setup">
        <div class="setup-head">
          <div class="brand-block">
            <h1 class="setup-title">CS2 Stats Overlay</h1>
            <p class="setup-sub">Customize and use your own browser source overlay for Premier or FACEIT. Data provided by <a class="leetify-link" href="https://leetify.com" target="_blank" rel="noopener">Leetify</a></p>
          </div>
          <div class="link-row">
            <a class="link-chip link-repo" data-link="github" href="${REPO_URL}" target="_blank" rel="noopener">${ICON_GITHUB}<span>kapkit-cs2overlay</span></a>
            <a class="link-chip link-kofi" data-link="kofi" href="${KOFI_URL}" target="_blank" rel="noopener" aria-label="Ko-fi">${ICON_KOFI}</a>
            <a class="link-chip link-twitch" data-link="twitch" href="${TWITCH_URL}" target="_blank" rel="noopener" aria-label="Twitch">${ICON_TWITCH}</a>
          </div>
        </div>

        <div class="setup-body">
          <div class="field">
            <label class="group-label" for="steam-id">FACEIT or STEAM Link</label>
            <div class="link-field">
              <span class="link-icon" aria-hidden="true">${ICON_GLOBE}</span>
              <input type="text" id="steam-id" class="link-input" placeholder="https://steamcommunity.com/id/yourname" autocomplete="off" spellcheck="false">
            </div>
          </div>

          <div class="field">
            <label class="group-label" for="live-channel">Stream Link (Twitch, YT, Kick)</label>
            <div class="link-field">
              <span class="link-icon" id="live-icon" aria-hidden="true">${ICON_GLOBE}</span>
              <input type="text" id="live-channel" class="link-input" placeholder="https://twitch.tv/yourchannel" autocomplete="off" spellcheck="false">
            </div>
          </div>

          <div class="divider" role="separator"></div>

          <div class="seg-track provider-toggle" id="provider-toggle">
            <button type="button" class="seg" data-provider="leetify">PREMIER</button>
            <button type="button" class="seg" data-provider="faceit">FACEIT</button>
          </div>

          <section class="group">
            <div class="group-head">
              <h2 class="group-label">DATA</h2>
              <button type="button" class="reset-btn" data-reset="data" aria-label="Reset data options">${ICON_RESET}</button>
            </div>
            <div class="check-grid">
              <label class="check" id="flag-row" hidden><input type="checkbox" id="show-flag"><span class="check-text">Flag</span></label>
              <label class="check"><input type="checkbox" id="show-name"><span class="check-text">Name</span></label>
              <label class="check" id="badge-row"><input type="checkbox" id="show-badge"><span class="check-text">Styled Rank</span></label>
              <label class="check"><input type="checkbox" id="show-wl"><span class="check-text">W/L</span></label>
              <label class="check"><input type="checkbox" id="show-stats"><span class="check-text">Stats</span></label>
              <label class="check"><input type="checkbox" id="show-change"><span class="check-text">Gain</span></label>
              <label class="check"><input type="checkbox" id="show-history"><span class="check-text">Match History</span></label>
            </div>

            <div class="advanced" id="advanced" hidden>
              <div class="opt-row">
                <span class="opt-label opt-label-fixed">Win/Loss</span>
                <div class="seg-track" id="wl-mode">
                  <button type="button" class="seg" data-mode="live">STREAM</button>
                  <button type="button" class="seg" data-mode="leetify">TOTAL</button>
                </div>
              </div>

              <div class="opt-col">
                <span class="opt-label">Stats (Max. ${STAT_MAX})</span>
                <div class="pill-row" id="stats-pills">${statPillsHtml()}</div>
              </div>

              <div class="opt-row" id="history-mode-row" hidden>
                <span class="opt-label">Match History</span>
                <div class="seg-track" id="history-mode">
                  <button type="button" class="seg" data-hist="wl">W/L</button>
                  <button type="button" class="seg" data-hist="elo">ELO</button>
                </div>
              </div>
            </div>

            <button type="button" class="advanced-btn" id="advanced-toggle" aria-controls="advanced" aria-expanded="false">SHOW ADVANCED</button>
          </section>

          <div class="divider" role="separator"></div>

          <section class="group">
            <div class="group-head">
              <h2 class="group-label">BACKGROUND</h2>
              <button type="button" class="reset-btn" data-reset="background" aria-label="Reset background options">${ICON_RESET}</button>
            </div>
            <div class="bg-stack">
              <div class="bg-field">
                <label class="swatch">
                  <input type="color" id="bg-color" value="#141414" aria-label="Background color">
                </label>
                <input type="text" id="bg-hex" class="bg-hex" value="141414" maxlength="7" spellcheck="false" aria-label="Background hex">
                <span class="bg-sep" aria-hidden="true"></span>
                <input type="text" id="bg-opacity" class="bg-opacity" value="100" maxlength="3" inputmode="numeric" aria-label="Background opacity percent">
                <span class="bg-pct" aria-hidden="true">%</span>
              </div>

              <div class="field field-tight">
                <span class="opt-label" id="corner-radius-label">Corner Radius (px)</span>
                <div class="seg-track" id="corner-radius" role="group" aria-labelledby="corner-radius-label">
                  ${CORNER_RADII.map((r) => `<button type="button" class="seg" data-radius="${r}">${r}</button>`).join("")}
                </div>
              </div>
            </div>
          </section>

          <div class="divider" role="separator"></div>

          <section class="group">
            <div class="group-head">
              <h2 class="group-label">TEXT</h2>
              <button type="button" class="reset-btn" data-reset="text" aria-label="Reset text options">${ICON_RESET}</button>
            </div>
            <div class="text-row">
              <div class="combo">
                <div class="combo-box">
                  <input type="text" id="font-search" class="field-input combo-input" placeholder="Search Google Fonts…" autocomplete="off" spellcheck="false" aria-label="Font">
                  <span class="combo-caret">${ICON_CARET}</span>
                </div>
                <div class="combo-list" id="font-list" hidden></div>
              </div>
              <div class="select-box">
                <select id="font-weight" class="field-input select" aria-label="Font weight">${weightOptionsHtml()}</select>
                <span class="combo-caret">${ICON_CARET}</span>
              </div>
            </div>
          </section>
        </div>

        <div class="setup-foot">
          <img class="foot-logo" src="${brandLogoSrc}" alt="kapKit">
          <div class="foot-legal">
            <button type="button" class="foot-link" id="open-privacy">Privacy Policy</button>
            <span class="foot-sep" aria-hidden="true"></span>
            <button type="button" class="foot-link" id="open-tos">Terms of Service</button>
          </div>
        </div>
      </aside>

      <div class="stage">
        <div class="exportbar is-empty" id="exportbar">
          <div class="export-url">
            <label class="field-label" for="generated-url">OBS Browser Source URL</label>
            <div class="url-box">
              <input type="text" id="generated-url" class="url-input" readonly placeholder="Enter a Steam ID to generate the URL">
              <button type="button" id="copy-url" class="icon-btn" aria-label="Copy URL"><span class="icon-copy">${ICON_COPY}</span><span class="icon-check">${ICON_CHECK}</span></button>
            </div>
          </div>
          <div class="export-zip">
            <label class="field-label">Custom Widget</label>
            <button type="button" id="export-zip" class="zip-btn" disabled><span class="se-logo">${ICON_STREAMELEMENTS}</span><span class="zip-label">DOWNLOAD ZIP</span></button>
          </div>
        </div>

        <div class="preview" id="preview">
          <div class="preview-banner" id="preview-banner" hidden>${ICON_WARNING}<span id="preview-banner-text"></span></div>
          <div class="preview-body" id="preview-widget"></div>
        </div>
      </div>
    </div>
  `;

  bindControls();
  syncControlsFromConfig();
  bindScrollFades();
  mountConsentUi();
  mountTos();

  // Re-fit the preview when the responsive layout changes the panel size.
  window.addEventListener("resize", fitPreview);

  const params = new URLSearchParams(window.location.search);
  const idFromUrl = params.get("id");
  if (idFromUrl) {
    const steamInput = document.getElementById("steam-id") as HTMLInputElement;
    steamInput.value = idFromUrl;
    resolveAndLoad(idFromUrl);
  } else {
    renderPreview();
  }
}

init();
