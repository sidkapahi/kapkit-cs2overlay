// Country flags for FACEIT mode. Uses the flag-icons set (lipis,
// https://flagicons.lipis.dev/, MIT) 4:3 variants, vendored into public/flags/
// and served from the site's own origin — self-hosted rather than a runtime CDN,
// so there's no third-party dependency and it works offline / in OBS. Keyed by
// the ISO 3166-1 alpha-2 country code FACEIT returns for a player. The corner
// radius is applied in CSS (see widget.css), not baked into the art.

// The flag image URL for a country code, or '' when there's no usable code (so
// the widget renders the name with no flag rather than a broken image). The path
// is absolute from the site root, where Vite serves public/ (build base is '/').
export function flagUrl(country: string | undefined): string {
  if (!country) return '';
  const code = country.toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return '';
  return `/flags/${code}.svg`;
}

// FACEIT's CS2 regions. Their icons are public/flags/regions/<code>.svg (4:3,
// like the country flags), shown in place of the country flag while the name
// shows the regional rank.
const REGIONS = ['eu', 'na', 'sa', 'oce', 'sea'];

// The region icon URL for a FACEIT region code, or '' for one we have no icon for.
export function regionFlagUrl(region: string | undefined): string {
  const code = region?.toLowerCase() ?? '';
  return REGIONS.includes(code) ? `/flags/regions/${code}.svg` : '';
}
