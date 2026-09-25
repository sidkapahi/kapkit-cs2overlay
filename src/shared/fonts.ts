// A large, searchable list of Google Fonts offered in the customizer's Design
// section. Every family here ships at least the 400 and 700 weights the widget
// relies on, so the on-demand loader below can request them without a 400 from
// the css2 API. Inter is the default and is already bundled via the base CSS.
export const GOOGLE_FONTS: string[] = [
  'Inter',
  'Abel',
  'Advent Pro',
  'Alfa Slab One',
  'Anton',
  'Archivo',
  'Archivo Black',
  'Archivo Narrow',
  'Arimo',
  'Arvo',
  'Asap',
  'Assistant',
  'Barlow',
  'Barlow Condensed',
  'Barlow Semi Condensed',
  'Bebas Neue',
  'Bitter',
  'Cabin',
  'Cairo',
  'Catamaran',
  'Chakra Petch',
  'Chivo',
  'Comfortaa',
  'Cousine',
  'DM Mono',
  'DM Sans',
  'DM Serif Display',
  'Dosis',
  'EB Garamond',
  'Electrolize',
  'Exo',
  'Exo 2',
  'Fira Code',
  'Fira Sans',
  'Fjalla One',
  'Francois One',
  'Heebo',
  'Hind',
  'IBM Plex Mono',
  'IBM Plex Sans',
  'IBM Plex Serif',
  'Inconsolata',
  'JetBrains Mono',
  'Josefin Sans',
  'Jost',
  'Kanit',
  'Karla',
  'Lato',
  'Lexend',
  'Libre Franklin',
  'Lora',
  'Manrope',
  'Merriweather',
  'Merriweather Sans',
  'Michroma',
  'Montserrat',
  'Montserrat Alternates',
  'Mukta',
  'Mulish',
  'Nanum Gothic',
  'Noto Sans',
  'Noto Serif',
  'Nunito',
  'Nunito Sans',
  'Open Sans',
  'Orbitron',
  'Oswald',
  'Overpass',
  'Oxanium',
  'PT Sans',
  'PT Serif',
  'Playfair Display',
  'Poppins',
  'Prompt',
  'Quicksand',
  'Rajdhani',
  'Raleway',
  'Red Hat Display',
  'Roboto',
  'Roboto Condensed',
  'Roboto Flex',
  'Roboto Mono',
  'Roboto Slab',
  'Rubik',
  'Russo One',
  'Saira',
  'Saira Condensed',
  'Saira Semi Condensed',
  'Sarabun',
  'Signika',
  'Sora',
  'Source Code Pro',
  'Source Sans 3',
  'Source Serif 4',
  'Space Grotesk',
  'Space Mono',
  'Spline Sans',
  'Teko',
  'Titillium Web',
  'Ubuntu',
  'Urbanist',
  'Varela Round',
  'Work Sans',
  'Yanone Kaffeesatz',
  'Zilla Slab',
];

// The selectable font weights shown next to the Font picker. Values are real
// CSS font-weights; labels are the usual names. 700 (Bold) is the default so the
// widget's original look is unchanged.
export interface FontWeightOption {
  value: number;
  label: string;
}
export const FONT_WEIGHTS: FontWeightOption[] = [
  { value: 300, label: 'Light' },
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'Semibold' },
  { value: 700, label: 'Bold' },
  { value: 800, label: 'Extrabold' },
  { value: 900, label: 'Black' },
];

// Builds the CSS font-family stack for a chosen family, always falling back to
// Inter and then a generic sans-serif so a not-yet-loaded font still renders.
export function fontStack(family: string): string {
  const quoted = `'${family.replace(/'/g, '')}'`;
  return family === 'Inter' ? `${quoted}, sans-serif` : `${quoted}, 'Inter', sans-serif`;
}

// Adds one Google Fonts <link> for a single (family, weight), idempotent per
// family+weight+document. Each weight is its own request so that asking for a
// weight a family doesn't publish only fails that one link — the base 400/700
// the widget always needs keep loading regardless.
function ensureWeightLink(family: string, weight: number, doc: Document): void {
  const id = `gf-${family.replace(/\s+/g, '-').toLowerCase()}-${weight}`;
  if (doc.getElementById(id)) return;
  const link = doc.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  const fam = family.trim().replace(/\s+/g, '+');
  link.href = `https://fonts.googleapis.com/css2?family=${fam}:wght@${weight}&display=swap`;
  doc.head.appendChild(link);
}

// Injects (once) the Google Fonts <link>s for a family so the chosen font is
// actually available when the widget applies it. Always loads the 400/700 the
// widget relies on and the 800 the rating/ELO is pinned to, plus the specific
// `weight` the user picked (when it's something else). Inter is bundled across
// weights via the base CSS import, so it's skipped.
export function loadFont(family: string, weight?: number, doc: Document = document): void {
  if (!family || family === 'Inter') return;
  ensureWeightLink(family, 400, doc);
  ensureWeightLink(family, 700, doc);
  ensureWeightLink(family, 800, doc);
  if (weight && weight !== 400 && weight !== 700 && weight !== 800) ensureWeightLink(family, weight, doc);
}
