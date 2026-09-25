// Turns whatever a user pastes into the Steam-ID box — a raw Steam64 ID, a full
// profile URL, or a custom (vanity) URL — into a usable Steam64 ID.
//
// Two profile-URL shapes exist on Steam:
//   • https://steamcommunity.com/profiles/76561198012345678  → the 17-digit
//     Steam64 ID is right there in the path, so we extract it locally.
//   • https://steamcommunity.com/id/gabelogannewell          → a custom vanity
//     name that only Steam's Web API can map to a Steam64 ID. That needs the
//     secret API key, so it's resolved server-side by the proxy Worker
//     (see resolveVanityUrl in api.ts).

export type SteamInput =
  | { kind: "id"; steamId: string } // ready-to-use 17-digit Steam64 ID
  | { kind: "vanity"; vanity: string } // needs server-side resolution
  | { kind: "empty" } // nothing entered yet
  | { kind: "invalid" }; // not a recognisable Steam ID / profile URL

// Steam64 IDs are 17-digit numbers.
const STEAM64_RE = /^\d{17}$/;
// Steam vanity names are letters, digits, dashes, underscores and dots.
const VANITY_RE = /^[A-Za-z0-9_.-]{2,64}$/;

export function parseSteamInput(raw: string): SteamInput {
  const input = raw.trim();
  if (!input) return { kind: "empty" };

  // A bare 17-digit number is already a Steam64 ID.
  if (STEAM64_RE.test(input)) return { kind: "id", steamId: input };

  // Try to read it as a steamcommunity.com URL (with or without a scheme).
  const path = tryParseSteamPath(input);
  if (path) {
    const profiles = path.match(/\/profiles\/(\d{17})\b/);
    if (profiles) return { kind: "id", steamId: profiles[1] };
    const vanity = path.match(/\/id\/([A-Za-z0-9_.-]{2,64})/);
    if (vanity) return { kind: "vanity", vanity: vanity[1] };
    return { kind: "invalid" };
  }

  // Not a URL and not a full Steam64 ID. Purely-numeric input is treated as an
  // incomplete/invalid Steam64 (not a vanity), so a half-typed ID isn't sent
  // off for resolution; anything else is taken as a bare vanity name.
  if (/^\d+$/.test(input)) return { kind: "invalid" };
  if (VANITY_RE.test(input)) return { kind: "vanity", vanity: input };
  return { kind: "invalid" };
}

// A parsed "Account" input — the universal field that accepts a Steam identity
// OR a FACEIT identity. Everything ultimately resolves to a Steam64 ID (both
// providers key off it); the resolution itself is done in the customizer since
// vanity/FACEIT lookups need the proxy Workers.
export type AccountInput =
  | { kind: 'id'; steamId: string } // ready-to-use Steam64 ID
  | { kind: 'steamVanity'; vanity: string } // steamcommunity.com/id/<name>
  | { kind: 'faceit'; nickname: string } // faceit.com/.../players/<nick>
  | { kind: 'ambiguous'; token: string } // a bare word — could be either
  | { kind: 'empty' }
  | { kind: 'invalid' };

// FACEIT nicknames are letters, digits, and a small set of punctuation.
const FACEIT_NICK_RE = /^[A-Za-z0-9_.\-[\]|~]{1,64}$/;

// Pulls the nickname out of a FACEIT profile link, e.g.
// https://www.faceit.com/en/players/s1mple (optionally with a trailing path or
// a two-letter locale segment). Returns null when it isn't a FACEIT link.
function faceitNicknameFromUrl(input: string): string | null {
  const m = /faceit\.com\/(?:[a-z]{2}\/)?players(?:-modal)?\/([^/?#]+)/i.exec(input);
  if (!m) return null;
  const nick = decodeURIComponent(m[1]);
  return FACEIT_NICK_RE.test(nick) ? nick : null;
}

// Classifies whatever a user types in the Account field. Explicit forms are
// unambiguous (a steamcommunity.com or faceit.com link, a 17-digit Steam64 ID);
// a bare word could be a Steam vanity or a FACEIT nickname, so it's returned as
// `ambiguous` for the customizer to resolve (it tries the current provider's
// source first, then the other).
export function parseAccountInput(raw: string): AccountInput {
  const input = raw.trim();
  if (!input) return { kind: 'empty' };

  // FACEIT profile link.
  const faceitNick = faceitNicknameFromUrl(input);
  if (faceitNick) return { kind: 'faceit', nickname: faceitNick };
  if (/faceit\.com/i.test(input)) return { kind: 'invalid' }; // a FACEIT URL we couldn't read

  // A Steam URL is unambiguously Steam — reuse parseSteamInput for /profiles/
  // (→ id) and /id/<name> (→ vanity).
  if (/^https?:\/\//i.test(input) || /^steamcommunity\.com\//i.test(input)) {
    const steam = parseSteamInput(input);
    if (steam.kind === 'id') return { kind: 'id', steamId: steam.steamId };
    if (steam.kind === 'vanity') return { kind: 'steamVanity', vanity: steam.vanity };
    return { kind: 'invalid' };
  }

  // A bare word: a 17-digit Steam64, or an ambiguous name. Match the FACEIT
  // charset (a superset of Steam vanities), so a FACEIT-only nickname like
  // `big|clan` still resolves; the customizer disambiguates by provider.
  if (/^\d{17}$/.test(input)) return { kind: 'id', steamId: input };
  if (/^\d+$/.test(input)) return { kind: 'invalid' }; // an incomplete numeric id
  if (FACEIT_NICK_RE.test(input)) return { kind: 'ambiguous', token: input };
  return { kind: 'invalid' };
}

// Which platform a pasted profile link belongs to, or null when the input isn't
// a link (a bare Steam64 ID or name says nothing about the overlay type). Used
// by the customizer to flip the PREMIER | FACEIT toggle to match the link.
export function detectLinkPlatform(raw: string): 'faceit' | 'steam' | null {
  const input = raw.trim();
  if (faceitNicknameFromUrl(input)) return 'faceit';
  if (tryParseSteamPath(input)) return 'steam';
  return null;
}

// Returns the path of a steamcommunity.com URL, or null if the input isn't one.
// Accepts inputs without a scheme (e.g. a pasted "steamcommunity.com/id/foo").
function tryParseSteamPath(input: string): string | null {
  let candidate = input;
  if (!/^https?:\/\//i.test(candidate)) {
    if (!/^steamcommunity\.com\//i.test(candidate)) return null;
    candidate = "https://" + candidate;
  }
  try {
    const url = new URL(candidate);
    if (url.hostname.toLowerCase() !== "steamcommunity.com") return null;
    return url.pathname;
  } catch {
    return null;
  }
}
