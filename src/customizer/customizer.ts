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
import { parseAccountInput, type AccountInput } from "../shared/steamId";
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
const ICON_CARET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
// Pencil for the live-session chip's "edit" button (return to the input).
const ICON_PENCIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
// Monochrome platform mark shown in the live-session chip, keyed by platform.
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
    showWinLoss: config.showWinLoss,
    showChange: config.showChange,
    matchCount: config.matchCount,
    bgOpacity: config.bgOpacity,
    cornerRadius: config.cornerRadius,
    usesLive: Boolean(config.livePlatform),
    livePlatform: config.livePlatform,
  };
}
let previewData: PremierData | null = null;
let previewError: string | null = null;
let previewLoading = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastTrackedSteamId: string | null = null;
// Last live channel we counted, so adopting a channel fires one adoption event
// (not one per keystroke).
let lastTrackedLive = "";
// Which source drives the W/L pills: 'leetify' = rolling window, 'live' =
// per-stream session (reveals the live-channel field). Mirrors whether a live
// channel is set on the config.
let wlMode: "leetify" | "live" = "leetify";
// When true, show the live-channel input even though a channel is set — i.e. the
// user is entering or editing a link. When false (and a channel is set), the
// input collapses into the platform chip.
let editingLive = false;
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

function renderPreview() {
  const body = document.getElementById("preview-widget");
  const banner = document.getElementById("preview-banner");
  const bannerText = document.getElementById("preview-banner-text");
  if (!body || !banner || !bannerText) return;

  if (previewError) {
    bannerText.textContent = previewError;
    banner.hidden = false;
    // Keep the last good widget behind the banner if we have one; otherwise the
    // prompt card so the panel never looks broken.
    body.innerHTML = previewData
      ? renderWidget(currentConfig, previewData)
      : promptCardHtml(PROMPT_TEXT);
  } else {
    banner.hidden = true;
    if (previewLoading) {
      body.innerHTML = renderMessage("Loading", "…");
    } else if (!previewData) {
      body.innerHTML = promptCardHtml(PROMPT_TEXT);
    } else {
      body.innerHTML = renderWidget(currentConfig, previewData);
    }
  }

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
  const token = ++resolveToken;
  const parsed = parseAccountInput(rawInput);

  if (parsed.kind === "empty") {
    currentConfig.steamId = "";
    previewData = null;
    previewError = null;
    previewLoading = false;
    renderPreview();
    updateGeneratedUrl();
    return;
  }

  if (parsed.kind === "invalid") {
    currentConfig.steamId = "";
    previewData = null;
    previewError = "Enter a Steam ID / profile link or a FACEIT link / username";
    previewLoading = false;
    renderPreview();
    updateGeneratedUrl();
    return;
  }

  // A plain Steam64 needs no lookup; every other form is a network round-trip.
  let steamId: string;
  if (parsed.kind === "id") {
    steamId = parsed.steamId;
  } else {
    previewLoading = true;
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
      previewData = null;
      previewLoading = false;
      currentConfig.steamId = "";
      renderPreview();
      updateGeneratedUrl();
      return;
    }
    if (token !== resolveToken) return; // superseded by newer input
  }

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

async function loadPreview(token = ++resolveToken) {
  if (!currentConfig.steamId) {
    previewData = null;
    previewError = null;
    previewLoading = false;
    renderPreview();
    return;
  }

  previewLoading = true;
  previewError = null;
  renderPreview();

  try {
    const data =
      currentConfig.provider === "faceit"
        // Fetch up to matchCount so toggling the stats block (which caps the
        // strip at 5) never needs a re-fetch; the widget itself fetches the
        // exact 5/10 via faceitHistoryCount.
        ? await fetchFaceitData(currentConfig.steamId, currentConfig.matchCount)
        : await fetchPremierData(currentConfig.steamId);
    if (token !== resolveToken) return; // superseded by newer input
    previewData = data;
    if (currentConfig.steamId !== lastTrackedSteamId) {
      // Just a funnel count — no Steam ID sent (we only want *that* someone got
      // this far, not *who*).
      trackEvent("steam_id_entered");
      lastTrackedSteamId = currentConfig.steamId;
    }
  } catch (e) {
    if (token !== resolveToken) return; // superseded by newer input
    trackEvent("preview_error", {
      stage: "stats",
      reason: classifyFetchError(e),
      detail: errorDetail(e),
      provider: currentConfig.provider,
    });
    previewError = e instanceof Error ? e.message : "Failed to load";
    previewData = null;
  }
  previewLoading = false;
  renderPreview();
  updateGeneratedUrl();
}

function debouncedLoadPreview(rawInput: string) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => resolveAndLoad(rawInput), 600);
}

// Switches the active data source. The Steam identity and its input stay put —
// only the stat trio/pills, the provider-specific Design rows, and the preview's
// data source change. Re-fetches the current Steam ID against the new provider.
function setProvider(provider: Provider) {
  if (currentConfig.provider === provider) return;
  currentConfig.provider = provider;
  currentConfig.stats = [...DEFAULT_STATS_BY_PROVIDER[provider]];

  const pills = document.getElementById("stats-pills");
  if (pills) pills.innerHTML = statPillsHtml();
  syncStatsUi();
  syncProviderToggle();
  syncProviderRows();

  if (currentConfig.steamId) loadPreview();
  else renderPreview();
  updateGeneratedUrl();
  trackEvent("provider_selected", { provider });
}

function syncProviderToggle() {
  const row = document.getElementById("provider-toggle");
  if (!row) return;
  for (const seg of row.querySelectorAll<HTMLButtonElement>(".seg")) {
    seg.classList.toggle("selected", seg.dataset.provider === currentConfig.provider);
  }
}

// Shows the Design toggles that belong to the current provider: FACEIT gets a
// Flag toggle (no Avatar, no in-game Badge — the dial is always shown); Premier
// gets Avatar + Badge (no Flag).
function syncProviderRows() {
  const faceit = currentConfig.provider === "faceit";
  const set = (id: string, hidden: boolean) => {
    const el = document.getElementById(id);
    if (el) el.hidden = hidden;
  };
  set("flag-row", !faceit);
  set("avatar-row", faceit);
  set("badge-row", faceit);
}

// Simple display toggles → config keys. Stats and win/loss gate nested controls,
// so they're bound separately.
const checkboxMap: Record<string, keyof WidgetConfig> = {
  "show-avatar": "showAvatar",
  "show-flag": "showFlag",
  "show-name": "showName",
  "show-change": "showChange",
  "show-history": "showMatchHistory",
  "show-badge": "showBadge",
};

// ---- Stats picker (pill row) ---------------------------------------------
function syncStatsUi() {
  const on = currentConfig.showStats;
  const row = document.getElementById("stats-pills")!;
  // Collapse the stat pills entirely when the block is off, rather than showing
  // them dimmed — the sub-options only belong in the list when their parent is on.
  row.hidden = !on;

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

// ---- Win/Loss source toggle (Leetify vs live session) ---------------------
function syncWlUi() {
  const on = currentConfig.showWinLoss;
  const row = document.getElementById("wl-mode")!;
  // Hide the Leetify/Live source picker entirely when W/L is off — the sub-
  // options only belong in the list when their parent is on.
  row.hidden = !on;
  for (const seg of row.querySelectorAll<HTMLButtonElement>(".seg")) {
    seg.classList.toggle("selected", seg.dataset.mode === wlMode);
    seg.disabled = !on;
  }

  // In Live mode: once a valid channel is set (and we're not editing) the input
  // collapses into the platform chip; otherwise the input is shown so the user
  // can paste a link.
  const liveActive = on && wlMode === "live";
  const hasChannel = !!currentConfig.livePlatform && !!currentConfig.liveChannel;
  const showChip = liveActive && hasChannel && !editingLive;

  const liveField = document.getElementById("live-channel") as HTMLInputElement;
  const chip = document.getElementById("live-chip")!;
  liveField.hidden = !(liveActive && !showChip);
  chip.hidden = !showChip;
  if (showChip) renderLiveChip();
}

// Fills the chip with the current platform's mark and channel name.
function renderLiveChip() {
  const logo = document.getElementById("live-chip-logo")!;
  const name = document.getElementById("live-chip-name")!;
  logo.innerHTML = LIVE_PLATFORM_MARKS[currentConfig.livePlatform] ?? "";
  name.textContent = currentConfig.liveChannel;
}

// Reads the live-channel input, detects the platform, and writes the parsed
// result onto the config. Returns the config's channel (or '' if unusable).
function applyLiveInput(): string {
  const liveField = document.getElementById("live-channel") as HTMLInputElement;
  const parsed = parseLiveInput(liveField.value);
  currentConfig.livePlatform = parsed?.platform ?? "";
  currentConfig.liveChannel = parsed?.channel ?? "";
  return currentConfig.liveChannel;
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

  const row = document.getElementById("wl-mode")!;
  row.addEventListener("click", (e) => {
    const seg = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg");
    if (!seg || seg.disabled) return;
    wlMode = seg.dataset.mode === "live" ? "live" : "leetify";
    // Leetify mode drops the live channel entirely; Live mode adopts whatever is
    // already typed in the (now visible) field.
    if (wlMode === "live") {
      applyLiveInput();
      editingLive = false; // show the chip if a channel is already set
    } else {
      currentConfig.livePlatform = "";
      currentConfig.liveChannel = "";
    }
    trackLiveSelected();
    syncWlUi();
    // If we dropped into the empty input, put the cursor there ready to paste.
    if (wlMode === "live" && !liveField.hidden) liveField.focus();
    updateGeneratedUrl();
  });

  // While the field is focused the user is editing, so keep the input visible.
  liveField.addEventListener("focus", () => {
    editingLive = true;
  });
  liveField.addEventListener("input", () => {
    // Update the preview/URL live as they type, but don't track yet: every
    // keystroke of a bare login is itself a "valid" channel, so tracking here
    // fires a live_selected per character. Tracking happens on commit (blur).
    applyLiveInput();
    updateGeneratedUrl();
  });
  // Leaving the field (blur) or pressing Enter collapses it into the chip once a
  // valid channel is present.
  liveField.addEventListener("blur", () => {
    editingLive = false;
    // Commit point: the user has finished typing (blurred or pressed Enter, which
    // blurs). Track the final channel here so we get one event per real channel
    // rather than one per keystroke.
    trackLiveSelected();
    syncWlUi();
  });
  liveField.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      liveField.blur();
    }
  });

  // The chip's pencil returns to the default input state so the link can be
  // changed (its current value stays, selected, ready to overwrite).
  document.getElementById("live-chip-edit")!.addEventListener("click", () => {
    editingLive = true;
    syncWlUi();
    liveField.focus();
    liveField.select();
  });
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
function bindBackground() {
  const color = document.getElementById("bg-color") as HTMLInputElement;
  const hex = document.getElementById("bg-hex") as HTMLInputElement;
  const opacity = document.getElementById("bg-opacity") as HTMLInputElement;

  const applyColor = (value: string) => {
    currentConfig.bgColor = value;
    color.value = value;
    hex.value = value;
    renderPreview();
    updateGeneratedUrl();
  };

  color.addEventListener("input", () => applyColor(color.value));

  hex.addEventListener("input", () => {
    const v = hex.value.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
      applyColor(v.startsWith("#") ? v.toLowerCase() : `#${v.toLowerCase()}`);
    }
  });

  // Opacity reads as "100%" but accepts a raw number while typing.
  opacity.addEventListener("focus", () => {
    opacity.value = String(currentConfig.bgOpacity);
  });
  opacity.addEventListener("input", () => {
    const digits = opacity.value.replace(/[^\d]/g, "");
    currentConfig.bgOpacity = Math.max(0, Math.min(100, parseInt(digits || "0", 10)));
    renderPreview();
    updateGeneratedUrl();
  });
  opacity.addEventListener("blur", () => {
    opacity.value = `${currentConfig.bgOpacity}%`;
  });
}

// ---- Corner radius segmented toggle --------------------------------------
function syncCornerRadius() {
  const row = document.getElementById("corner-radius")!;
  for (const seg of row.querySelectorAll<HTMLButtonElement>(".seg")) {
    seg.classList.toggle("selected", Number(seg.dataset.radius) === currentConfig.cornerRadius);
  }
}

function bindCornerRadius() {
  const row = document.getElementById("corner-radius")!;
  row.addEventListener("click", (e) => {
    const seg = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg");
    if (!seg) return;
    currentConfig.cornerRadius = Number(seg.dataset.radius) as CornerRadius;
    syncCornerRadius();
    renderPreview();
    updateGeneratedUrl();
  });
}

// Pushes currentConfig into every control (used on init).
function syncControlsFromConfig() {
  for (const [id, key] of Object.entries(checkboxMap)) {
    (document.getElementById(id) as HTMLInputElement).checked = currentConfig[
      key
    ] as boolean;
  }

  (document.getElementById("show-stats") as HTMLInputElement).checked =
    currentConfig.showStats;
  syncStatsUi();

  (document.getElementById("show-wl") as HTMLInputElement).checked =
    currentConfig.showWinLoss;
  wlMode = currentConfig.livePlatform ? "live" : "leetify";
  editingLive = false; // a restored channel shows as a chip, not an open input
  (document.getElementById("live-channel") as HTMLInputElement).value =
    currentConfig.liveChannel;
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
    currentConfig.bgColor;
  (document.getElementById("bg-opacity") as HTMLInputElement).value =
    `${currentConfig.bgOpacity}%`;
  syncCornerRadius();

  // Provider toggle + the provider-specific Design rows (Flag vs Avatar/Badge).
  syncProviderToggle();
  syncProviderRows();
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
  bindFont();
  bindWeight();
  bindBackground();
  bindCornerRadius();

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
          <p class="modal-updated">Last updated: 2026-08-26</p>
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
          <p>The OBS overlay itself sets <strong>no cookies</strong> and stores nothing on your machine for analytics. It sends only anonymous counts (that it loaded, that a stream went live, and errors), so it needs no consent and shows no banner on stream.</p>

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
            <h1 class="setup-title">CS2 Overlay Widget</h1>
            <p class="setup-sub">Customize and use your own browser source overlay for Premier or FACEIT. Data provided by <a class="leetify-link" href="https://leetify.com" target="_blank" rel="noopener">Leetify</a></p>
          </div>
          <div class="link-row">
            <a class="link-chip link-repo" data-link="github" href="${REPO_URL}" target="_blank" rel="noopener">${ICON_GITHUB}<span>kapkit-cs2overlay</span></a>
            <a class="link-chip link-kofi" data-link="kofi" href="${KOFI_URL}" target="_blank" rel="noopener" aria-label="Ko-fi">${ICON_KOFI}</a>
            <a class="link-chip link-twitch" data-link="twitch" href="${TWITCH_URL}" target="_blank" rel="noopener" aria-label="Twitch">${ICON_TWITCH}</a>
          </div>
        </div>

        <div class="setup-body">
          <section class="group group-steam">
            <h2 class="group-label" id="identity-label">ACCOUNT</h2>
            <input type="text" id="steam-id" class="field-input" placeholder="Steam ID / profile link, or FACEIT link / username" autocomplete="off" spellcheck="false">
            <div class="seg-row provider-toggle" id="provider-toggle">
              <button type="button" class="seg" data-provider="leetify">PREMIER</button>
              <button type="button" class="seg" data-provider="faceit">FACEIT</button>
            </div>
          </section>

          <div class="divider" role="separator"></div>

          <section class="group">
            <h2 class="group-label">DESIGN</h2>
            <div class="stack">
              <label class="check" id="flag-row" hidden><input type="checkbox" id="show-flag"><span class="check-text">Flag</span></label>
              <label class="check"><input type="checkbox" id="show-name"><span class="check-text">Name</span></label>
              <label class="check" id="avatar-row"><input type="checkbox" id="show-avatar"><span class="check-text">Avatar</span></label>
              <label class="check" id="badge-row"><input type="checkbox" id="show-badge"><span class="check-text">In-game Styled Badge</span></label>

              <div class="dual">
                <div class="field field-grow">
                  <label class="field-label" for="font-search">Font</label>
                  <div class="combo">
                    <div class="combo-box">
                      <input type="text" id="font-search" class="field-input combo-input" placeholder="Search Google Fonts…" autocomplete="off" spellcheck="false">
                      <span class="combo-caret">${ICON_CARET}</span>
                    </div>
                    <div class="combo-list" id="font-list" hidden></div>
                  </div>
                </div>
                <div class="field field-weight">
                  <label class="field-label" for="font-weight">Weight</label>
                  <select id="font-weight" class="field-input select">${weightOptionsHtml()}</select>
                </div>
              </div>

              <div class="dual">
                <div class="field field-grow">
                  <label class="field-label" for="bg-hex">Background Color</label>
                  <div class="color-row">
                    <label class="swatch">
                      <input type="color" id="bg-color" value="#141414" aria-label="Background color">
                    </label>
                    <input type="text" id="bg-hex" class="field-input hex" value="#141414" spellcheck="false" aria-label="Background hex">
                  </div>
                </div>
                <div class="field field-opacity">
                  <label class="field-label" for="bg-opacity">Opacity</label>
                  <input type="text" id="bg-opacity" class="field-input opacity" value="100%" inputmode="numeric" aria-label="Background opacity percent">
                </div>
              </div>

              <div class="field">
                <span class="field-label" id="corner-radius-label">Corner Radius</span>
                <div class="seg-row" id="corner-radius" role="group" aria-labelledby="corner-radius-label">
                  ${CORNER_RADII.map((r) => `<button type="button" class="seg" data-radius="${r}">${r}</button>`).join("")}
                </div>
              </div>
            </div>
          </section>

          <div class="divider" role="separator"></div>

          <section class="group">
            <h2 class="group-label">DATA</h2>
            <div class="stack">
              <label class="check"><input type="checkbox" id="show-change"><span class="check-text">Loss/Gain</span></label>

              <div class="check-group">
                <label class="check"><input type="checkbox" id="show-wl"><span class="check-text">Win Loss Record</span></label>
                <div class="seg-row" id="wl-mode">
                  <button type="button" class="seg" data-mode="leetify">TOTAL</button>
                  <button type="button" class="seg" data-mode="live">LIVE SESSION</button>
                </div>
                <input type="text" id="live-channel" class="field-input" placeholder="Twitch/Youtube/Kick profile link" autocomplete="off" spellcheck="false" hidden>
                <div class="live-chip" id="live-chip" hidden>
                  <span class="live-chip-logo" id="live-chip-logo" aria-hidden="true"></span>
                  <span class="live-chip-name" id="live-chip-name"></span>
                  <button type="button" class="live-chip-edit" id="live-chip-edit" aria-label="Edit live channel">${ICON_PENCIL}</button>
                </div>
              </div>

              <div class="check-group">
                <label class="check"><input type="checkbox" id="show-stats"><span class="check-text">Stats (${STAT_MAX} Max)</span></label>
                <div class="pill-row" id="stats-pills">${statPillsHtml()}</div>
              </div>

              <label class="check"><input type="checkbox" id="show-history"><span class="check-text">Match History</span></label>
            </div>
          </section>
        </div>

        <div class="setup-foot">
          <img class="foot-logo" src="${brandLogoSrc}" alt="kapKit">
          <div class="foot-legal">
            <button type="button" class="foot-link" id="open-privacy">Privacy &amp; Cookies</button>
            <span class="foot-sep" aria-hidden="true">·</span>
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
