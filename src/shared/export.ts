// Helpers for the "Add to your stream" export options: deep links to the
// StreamElements / Streamlabs editors and a downloadable StreamElements Custom
// Widget bundle. Everything here is client-side — there's no backend, so we
// can't push an overlay straight into someone's account (that needs their
// StreamElements OAuth login and a server). Instead we hand over the exact file
// set a Custom Widget expects (HTML / CSS / JS / FIELDS / DATA), pre-filled with
// the chosen config and wired so the fields stay editable inside StreamElements.
import { createZip } from './zip';
import { STAT_LABELS, type WidgetConfig } from './types';

// StreamElements' web overlay editor, linked from the bundle's README.
export const STREAMELEMENTS_EDITOR_URL =
  'https://streamelements.com/dashboard/overlays';

// Recommended browser-source size for the widget (kept in sync with the README).
export const RECOMMENDED_WIDTH = 660;
export const RECOMMENDED_HEIGHT = 180;

// Strips any query string, leaving the hosted widget's base URL (…/widget/).
function widgetBase(widgetUrl: string): string {
  return widgetUrl.split('?')[0];
}

// ---------------------------------------------------------------------------
// StreamElements Custom Widget bundle
//
// A Custom Widget is HTML + CSS + JS plus a FIELDS definition (the editable
// inputs shown in the SE side panel) and a DATA blob. Our HTML is a transparent
// iframe; the JS reads the fields on `onWidgetLoad` and points the iframe at the
// hosted widget with matching query params — so the streamer can tweak the same
// options from inside StreamElements and see them applied live.
// ---------------------------------------------------------------------------

function bundleHtml(): string {
  return `<div id="cs2-overlay">
  <iframe id="cs2-overlay-frame" scrolling="no" allowtransparency="true" frameborder="0"></iframe>
</div>
`;
}

function bundleCss(): string {
  return `html, body {
  margin: 0;
  padding: 0;
  background: transparent;
  overflow: hidden;
}

#cs2-overlay {
  width: ${RECOMMENDED_WIDTH}px;
  height: ${RECOMMENDED_HEIGHT}px;
}

#cs2-overlay-frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
  background: transparent;
}
`;
}

// The JS mirrors src/shared/config.ts::configToParams, but sets every param
// explicitly (the widget reads explicit values fine) so it stays simple and
// doesn't need to know the defaults.
function bundleJs(base: string): string {
  return `// CS2 Stats Overlay — StreamElements Custom Widget
// Builds the hosted widget URL from the editable fields and loads it in the iframe.
(function () {
  var BASE = ${JSON.stringify(base)};

  // Turns whatever is typed in the "live session" field into the widget's
  // \`live=<platform>:<channel>\` param: an already-formatted value passes through,
  // a Twitch/YouTube/Kick link is detected by host, and a bare handle defaults to
  // Twitch. The widget re-validates the channel, so loose extraction is fine.
  function parseLive(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    if (/^(twitch|youtube|kick):/i.test(s)) return s.toLowerCase().slice(0, s.indexOf(':')) + ':' + s.slice(s.indexOf(':') + 1);
    var lower = s.toLowerCase();
    var platform, token;
    if (lower.indexOf('youtube.com') >= 0 || lower.indexOf('youtu.be') >= 0) {
      platform = 'youtube';
      var ym = /youtube\\.com\\/(@[^/?#]+|channel\\/[^/?#]+|c\\/[^/?#]+|user\\/[^/?#]+)/i.exec(s);
      token = ym ? ym[1].replace(/^(?:channel|c|user)\\//i, '') : s;
    } else if (lower.indexOf('kick.com') >= 0) {
      platform = 'kick';
      var km = /kick\\.com\\/([^/?#]+)/i.exec(s);
      token = km ? km[1] : s;
    } else {
      platform = 'twitch';
      var tm = /twitch\\.tv\\/([^/?#]+)/i.exec(s);
      token = tm ? tm[1] : s;
    }
    token = token.replace(/^@+/, '');
    return token ? platform + ':' + token : '';
  }

  function buildUrl(f) {
    f = f || {};
    var p = new URLSearchParams();
    p.set('steamId', String(f.steamId || '').trim());
    var live = parseLive(f.live);
    if (live) p.set('live', live);
    p.set('avatar', f.showAvatar ? '1' : '0');
    p.set('name', f.showName ? '1' : '0');
    p.set('badge', f.showBadge ? '1' : '0');
    p.set('change', f.showChange ? '1' : '0');
    p.set('wl', f.showWinLoss ? '1' : '0');
    if (f.showStats) {
      var stats = String(f.stats || '').trim();
      if (stats) p.set('stats', stats);
    } else {
      p.set('stats', 'off');
    }
    p.set('history', f.showMatchHistory ? '1' : '0');
    p.set('matchCount', String(f.matchCount || '10'));
    p.set('refresh', String(f.refreshInterval || '60'));
    if (f.font) p.set('font', String(f.font));
    if (f.fontWeight) p.set('fw', String(f.fontWeight));
    if (f.bgColor) p.set('bg', String(f.bgColor).replace(/^#/, ''));
    if (f.bgOpacity !== undefined && f.bgOpacity !== null && f.bgOpacity !== '') {
      p.set('bgo', String(f.bgOpacity));
    }
    if (f.cornerRadius !== undefined && f.cornerRadius !== null && f.cornerRadius !== '') {
      p.set('radius', String(f.cornerRadius));
    }
    return BASE + '?' + p.toString();
  }

  function apply(fieldData) {
    var frame = document.getElementById('cs2-overlay-frame');
    if (frame) frame.src = buildUrl(fieldData);
  }

  window.addEventListener('onWidgetLoad', function (obj) {
    apply(obj.detail.fieldData);
  });
})();
`;
}

// The FIELDS definition (SE side-panel inputs), pre-filled from the config.
function bundleFields(config: WidgetConfig): string {
  const statHint = Object.entries(STAT_LABELS)
    .map(([key, label]) => `${key} = ${label}`)
    .join(', ');

  const fields: Record<string, unknown> = {
    steamId: {
      type: 'text',
      label: 'Steam64 ID',
      value: config.steamId,
      group: 'Player',
    },
    live: {
      type: 'text',
      label: 'Live session — Twitch, YouTube, or Kick link (optional — session W/L)',
      value: config.livePlatform ? `${config.livePlatform}:${config.liveChannel}` : '',
      group: 'Player',
    },
    showAvatar: {
      type: 'checkbox',
      label: 'Show avatar',
      value: config.showAvatar,
      group: 'Data displayed',
    },
    showName: {
      type: 'checkbox',
      label: 'Show player name',
      value: config.showName,
      group: 'Data displayed',
    },
    showChange: {
      type: 'checkbox',
      label: 'Show rank change',
      value: config.showChange,
      group: 'Data displayed',
    },
    showWinLoss: {
      type: 'checkbox',
      label: 'Show win/loss',
      value: config.showWinLoss,
      group: 'Data displayed',
    },
    showStats: {
      type: 'checkbox',
      label: 'Show stats',
      value: config.showStats,
      group: 'Data displayed',
    },
    stats: {
      type: 'text',
      label: `Stats to show — up to 3, comma-separated (${statHint})`,
      value: config.stats.join(','),
      group: 'Data displayed',
    },
    showMatchHistory: {
      type: 'checkbox',
      label: 'Show match history',
      value: config.showMatchHistory,
      group: 'Data displayed',
    },
    showBadge: {
      type: 'checkbox',
      label: 'Show in-game rank badge instead',
      value: config.showBadge,
      group: 'Design',
    },
    font: {
      type: 'googleFont',
      label: 'Font',
      value: config.font,
      group: 'Design',
    },
    fontWeight: {
      type: 'dropdown',
      label: 'Font weight',
      value: String(config.fontWeight),
      options: {
        '300': 'Light',
        '400': 'Regular',
        '500': 'Medium',
        '600': 'Semibold',
        '700': 'Bold',
        '800': 'Extrabold',
        '900': 'Black',
      },
      group: 'Design',
    },
    bgColor: {
      type: 'colorpicker',
      label: 'Background color',
      value: config.bgColor,
      group: 'Design',
    },
    bgOpacity: {
      type: 'slider',
      label: 'Background opacity',
      value: config.bgOpacity,
      min: 0,
      max: 100,
      step: 1,
      group: 'Design',
    },
    cornerRadius: {
      type: 'dropdown',
      label: 'Corner radius',
      value: String(config.cornerRadius),
      options: { '0': '0', '24': '24', '32': '32', '100': '100' },
      group: 'Design',
    },
    matchCount: {
      type: 'dropdown',
      label: 'Recent matches for data',
      value: String(config.matchCount),
      options: { '5': '5', '10': '10' },
      group: 'Data',
    },
    refreshInterval: {
      type: 'dropdown',
      label: 'Refresh interval',
      value: String(config.refreshInterval),
      options: {
        '30': '30 seconds',
        '60': '1 minute',
        '180': '3 minutes',
        '300': '5 minutes',
      },
      group: 'Data',
    },
  };

  return JSON.stringify(fields, null, 2) + '\n';
}

function bundleReadme(widgetUrl: string): string {
  return `CS2 Stats Overlay — StreamElements Custom Widget
================================================

This bundle is the file set a StreamElements Custom Widget expects. It loads the
hosted widget in an iframe and exposes the same options as editable fields inside
StreamElements, so you can tweak them there without coming back here.

Import into StreamElements
--------------------------
1. Open your overlay editor: ${STREAMELEMENTS_EDITOR_URL}
2. Add Widget -> Static / Custom -> Custom Widget -> Open Editor.
3. Copy each file into its matching tab:
     widget.html  -> HTML tab
     widget.css   -> CSS tab
     widget.js    -> JS tab
     fields.json  -> FIELDS tab
     data.json    -> DATA tab
4. Save. Use the field inputs on the left to edit the Steam ID, toggles,
   colors, font, etc. Size the widget to ${RECOMMENDED_WIDTH} x ${RECOMMENDED_HEIGHT}.

Prefer a plain Browser Source? (OBS / Streamlabs / StreamElements)
------------------------------------------------------------------
Use this URL directly instead of the bundle:
  ${widgetUrl}
Recommended size: ${RECOMMENDED_WIDTH} x ${RECOMMENDED_HEIGHT}. See widget-url.txt.
`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Bundles the StreamElements Custom Widget files (plus the raw URL and a README)
// into a .zip and downloads it.
export function downloadOverlayZip(
  config: WidgetConfig,
  widgetUrl: string,
): void {
  const base = widgetBase(widgetUrl);
  const blob = createZip([
    { name: 'widget.html', data: bundleHtml() },
    { name: 'widget.css', data: bundleCss() },
    { name: 'widget.js', data: bundleJs(base) },
    { name: 'fields.json', data: bundleFields(config) },
    { name: 'data.json', data: '{}\n' },
    { name: 'widget-url.txt', data: `${widgetUrl}\n` },
    { name: 'README.txt', data: bundleReadme(widgetUrl) },
  ]);
  triggerDownload(blob, 'cs2-stats-overlay-streamelements.zip');
}
