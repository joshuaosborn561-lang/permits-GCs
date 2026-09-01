/**
 * Shared Shovels geography tokens for estimates + live pulls.
 *
 * Level rules (when geo_level is auto/omitted):
 * - ends with "County" → county endpoint
 * - 5-digit ZIP → zip (geo_id passthrough)
 * - 2-letter state → state
 * - otherwise → city
 *
 * Never silently treat a bare county name as a city hit inside another county
 * (Hunt → Hunt, Kerr, TX). Callers should pass "Hunt County, TX" or geo_level=county.
 */

import type { GeoKind } from '../lib/shovels.js';

export type GeoTarget = {
  kind: GeoKind;
  q: string;
  place: string;
  state?: string;
  /** Original token as the caller wrote it. */
  raw?: string;
};

export type GeoLevelHint = 'auto' | 'city' | 'county' | 'zip' | 'state';

const GEO_ALIASES: Record<string, GeoTarget | GeoTarget[]> = {
  dallas: { kind: 'city', q: 'Dallas', place: 'Dallas', state: 'TX' },
  dallas_city: { kind: 'city', q: 'Dallas', place: 'Dallas', state: 'TX' },
  dallas_county: { kind: 'county', q: 'Dallas', place: 'Dallas_County', state: 'TX' },
  fort_worth: { kind: 'county', q: 'Tarrant', place: 'Fort_Worth', state: 'TX' },
  fortworth: { kind: 'county', q: 'Tarrant', place: 'Fort_Worth', state: 'TX' },
  tarrant: { kind: 'county', q: 'Tarrant', place: 'Tarrant_County', state: 'TX' },
  tarrant_county: { kind: 'county', q: 'Tarrant', place: 'Tarrant_County', state: 'TX' },
  rockwall: { kind: 'county', q: 'Rockwall', place: 'Rockwall_County', state: 'TX' },
  rockwall_county: { kind: 'county', q: 'Rockwall', place: 'Rockwall_County', state: 'TX' },
  houston: { kind: 'city', q: 'Houston', place: 'Houston', state: 'TX' },
  harris: { kind: 'county', q: 'Harris', place: 'Harris_County', state: 'TX' },
  harris_county: { kind: 'county', q: 'Harris', place: 'Harris_County', state: 'TX' },
  austin: { kind: 'city', q: 'Austin', place: 'Austin', state: 'TX' },
  san_antonio: { kind: 'city', q: 'San Antonio', place: 'San_Antonio', state: 'TX' },

  // Outer-ring DFW counties (Peterson ~2hr radius) — bare name → county, not a random city
  denton: { kind: 'county', q: 'Denton', place: 'Denton_County', state: 'TX' },
  denton_county: { kind: 'county', q: 'Denton', place: 'Denton_County', state: 'TX' },
  collin: { kind: 'county', q: 'Collin', place: 'Collin_County', state: 'TX' },
  collin_county: { kind: 'county', q: 'Collin', place: 'Collin_County', state: 'TX' },
  ellis: { kind: 'county', q: 'Ellis', place: 'Ellis_County', state: 'TX' },
  ellis_county: { kind: 'county', q: 'Ellis', place: 'Ellis_County', state: 'TX' },
  johnson: { kind: 'county', q: 'Johnson', place: 'Johnson_County', state: 'TX' },
  johnson_county: { kind: 'county', q: 'Johnson', place: 'Johnson_County', state: 'TX' },
  parker: { kind: 'county', q: 'Parker', place: 'Parker_County', state: 'TX' },
  parker_county: { kind: 'county', q: 'Parker', place: 'Parker_County', state: 'TX' },
  kaufman: { kind: 'county', q: 'Kaufman', place: 'Kaufman_County', state: 'TX' },
  kaufman_county: { kind: 'county', q: 'Kaufman', place: 'Kaufman_County', state: 'TX' },
  hunt: { kind: 'county', q: 'Hunt', place: 'Hunt_County', state: 'TX' },
  hunt_county: { kind: 'county', q: 'Hunt', place: 'Hunt_County', state: 'TX' },
  grayson: { kind: 'county', q: 'Grayson', place: 'Grayson_County', state: 'TX' },
  grayson_county: { kind: 'county', q: 'Grayson', place: 'Grayson_County', state: 'TX' },
  wise: { kind: 'county', q: 'Wise', place: 'Wise_County', state: 'TX' },
  wise_county: { kind: 'county', q: 'Wise', place: 'Wise_County', state: 'TX' },
  navarro: { kind: 'county', q: 'Navarro', place: 'Navarro_County', state: 'TX' },
  navarro_county: { kind: 'county', q: 'Navarro', place: 'Navarro_County', state: 'TX' },
  hood: { kind: 'county', q: 'Hood', place: 'Hood_County', state: 'TX' },
  hood_county: { kind: 'county', q: 'Hood', place: 'Hood_County', state: 'TX' },
  cooke: { kind: 'county', q: 'Cooke', place: 'Cooke_County', state: 'TX' },
  cooke_county: { kind: 'county', q: 'Cooke', place: 'Cooke_County', state: 'TX' },
  fannin: { kind: 'county', q: 'Fannin', place: 'Fannin_County', state: 'TX' },
  fannin_county: { kind: 'county', q: 'Fannin', place: 'Fannin_County', state: 'TX' },
  van_zandt: { kind: 'county', q: 'Van Zandt', place: 'Van_Zandt_County', state: 'TX' },
  van_zandt_county: { kind: 'county', q: 'Van Zandt', place: 'Van_Zandt_County', state: 'TX' },
  henderson: { kind: 'county', q: 'Henderson', place: 'Henderson_County', state: 'TX' },
  henderson_county: { kind: 'county', q: 'Henderson', place: 'Henderson_County', state: 'TX' },
  hill: { kind: 'county', q: 'Hill', place: 'Hill_County', state: 'TX' },
  hill_county: { kind: 'county', q: 'Hill', place: 'Hill_County', state: 'TX' },
  erath: { kind: 'county', q: 'Erath', place: 'Erath_County', state: 'TX' },
  erath_county: { kind: 'county', q: 'Erath', place: 'Erath_County', state: 'TX' },
  palo_pinto: { kind: 'county', q: 'Palo Pinto', place: 'Palo_Pinto_County', state: 'TX' },
  palo_pinto_county: { kind: 'county', q: 'Palo Pinto', place: 'Palo_Pinto_County', state: 'TX' },
  somervell: { kind: 'county', q: 'Somervell', place: 'Somervell_County', state: 'TX' },
  somervell_county: { kind: 'county', q: 'Somervell', place: 'Somervell_County', state: 'TX' },
  // Sherman the panhandle county vs Sherman city in Grayson — require County suffix / explicit
  sherman_county: { kind: 'county', q: 'Sherman', place: 'Sherman_County', state: 'TX' },

  los_angeles: { kind: 'city', q: 'Los Angeles', place: 'Los_Angeles', state: 'CA' },
  la: { kind: 'city', q: 'Los Angeles', place: 'Los_Angeles', state: 'CA' },
  san_francisco: { kind: 'city', q: 'San Francisco', place: 'San_Francisco', state: 'CA' },
  sf: { kind: 'city', q: 'San Francisco', place: 'San_Francisco', state: 'CA' },
  san_diego: { kind: 'city', q: 'San Diego', place: 'San_Diego', state: 'CA' },
  seattle: { kind: 'city', q: 'Seattle', place: 'Seattle', state: 'WA' },
  portland: { kind: 'city', q: 'Portland', place: 'Portland', state: 'OR' },
  west_coast: [
    { kind: 'city', q: 'Los Angeles', place: 'Los_Angeles', state: 'CA' },
    { kind: 'city', q: 'San Francisco', place: 'San_Francisco', state: 'CA' },
    { kind: 'city', q: 'San Diego', place: 'San_Diego', state: 'CA' },
    { kind: 'city', q: 'Seattle', place: 'Seattle', state: 'WA' },
    { kind: 'city', q: 'Portland', place: 'Portland', state: 'OR' },
  ],
  westcoast: [
    { kind: 'city', q: 'Los Angeles', place: 'Los_Angeles', state: 'CA' },
    { kind: 'city', q: 'San Francisco', place: 'San_Francisco', state: 'CA' },
    { kind: 'city', q: 'San Diego', place: 'San_Diego', state: 'CA' },
    { kind: 'city', q: 'Seattle', place: 'Seattle', state: 'WA' },
    { kind: 'city', q: 'Portland', place: 'Portland', state: 'OR' },
  ],

  miami: { kind: 'city', q: 'Miami', place: 'Miami', state: 'FL' },
  atlanta: { kind: 'city', q: 'Atlanta', place: 'Atlanta', state: 'GA' },
  charlotte: { kind: 'city', q: 'Charlotte', place: 'Charlotte', state: 'NC' },
  new_york: { kind: 'city', q: 'New York', place: 'New_York', state: 'NY' },
  nyc: { kind: 'city', q: 'New York', place: 'New_York', state: 'NY' },
  boston: { kind: 'city', q: 'Boston', place: 'Boston', state: 'MA' },
  philadelphia: { kind: 'city', q: 'Philadelphia', place: 'Philadelphia', state: 'PA' },
  philly: { kind: 'city', q: 'Philadelphia', place: 'Philadelphia', state: 'PA' },
  washington: { kind: 'city', q: 'Washington', place: 'Washington_DC', state: 'DC' },
  washington_dc: { kind: 'city', q: 'Washington', place: 'Washington_DC', state: 'DC' },
  dc: { kind: 'city', q: 'Washington', place: 'Washington_DC', state: 'DC' },
  east_coast: [
    { kind: 'city', q: 'Miami', place: 'Miami', state: 'FL' },
    { kind: 'city', q: 'Atlanta', place: 'Atlanta', state: 'GA' },
    { kind: 'city', q: 'Charlotte', place: 'Charlotte', state: 'NC' },
    { kind: 'city', q: 'New York', place: 'New_York', state: 'NY' },
    { kind: 'city', q: 'Boston', place: 'Boston', state: 'MA' },
    { kind: 'city', q: 'Philadelphia', place: 'Philadelphia', state: 'PA' },
    { kind: 'city', q: 'Washington', place: 'Washington_DC', state: 'DC' },
  ],
  eastcoast: [
    { kind: 'city', q: 'Miami', place: 'Miami', state: 'FL' },
    { kind: 'city', q: 'Atlanta', place: 'Atlanta', state: 'GA' },
    { kind: 'city', q: 'Charlotte', place: 'Charlotte', state: 'NC' },
    { kind: 'city', q: 'New York', place: 'New_York', state: 'NY' },
    { kind: 'city', q: 'Boston', place: 'Boston', state: 'MA' },
    { kind: 'city', q: 'Philadelphia', place: 'Philadelphia', state: 'PA' },
    { kind: 'city', q: 'Washington', place: 'Washington_DC', state: 'DC' },
  ],
};

const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
]);

function pushUnique(out: GeoTarget[], seen: Set<string>, t: GeoTarget) {
  if (seen.has(t.place)) return;
  seen.add(t.place);
  out.push(t);
}

/**
 * Claude often emits "Denton County; TX; Collin County; TX" (state on its own
 * semicolon slot). Re-join those into "Denton County, TX" before tokenizing so
 * we never invent a phantom geo_id for bare "TX" (which used to resolve to Azle).
 */
export function normalizeGeoList(raw: string): string {
  let text = raw.trim();
  if (!text) return text;
  // "Denton County; TX" / "Denton County\nTX" → "Denton County, TX"
  text = text.replace(/\b(County)\s*[;\n]+\s*([A-Za-z]{2})\b/gi, (_, c: string, st: string) => {
    const code = st.toUpperCase();
    return US_STATES.has(code) ? `${c}, ${code}` : `${c}; ${st}`;
  });
  // "Dallas; TX" (city then bare state) → "Dallas, TX"
  text = text.replace(
    /(^|[;\n,])\s*([A-Za-z][A-Za-z .'-]{1,40}?)\s*[;\n]+\s*([A-Za-z]{2})\b/g,
    (full, lead: string, name: string, st: string) => {
      const code = st.toUpperCase();
      const n = name.trim();
      if (!US_STATES.has(code)) return full;
      if (n.length === 2 && US_STATES.has(n.toUpperCase())) return full;
      if (/^\d{5}/.test(n)) return full;
      return `${lead}${n}, ${code}`;
    },
  );
  return text;
}

/**
 * Tokenize a geos string without breaking "Denton County, TX".
 * Prefer `;` / newlines; protect `Name, ST` pairs before splitting on commas.
 */
export function tokenizeGeos(raw: string): string[] {
  const text = normalizeGeoList(raw);
  if (!text) return [];

  if (/[;\n]/.test(text)) {
    return text
      .split(/[;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((tok, i, arr) => {
        // Drop leftover bare state codes if the previous token already carries that state
        const st = tok.toUpperCase();
        if (tok.length === 2 && US_STATES.has(st) && i > 0) {
          const prev = arr[i - 1] || '';
          if (new RegExp(`,\\s*${st}\\b`, 'i').test(prev) || /county$/i.test(prev)) {
            return false;
          }
        }
        return true;
      });
  }

  // Pure zip list: 75001, 75002, 75201-1234
  if (/^[\d\s,\-]+$/.test(text)) {
    return text
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Protect "Something, TX" so commas between geos still work:
  // "Denton County, TX, Collin County, TX" → two tokens
  const protected_ = text.replace(
    /([^,;]+?)\s*,\s*([A-Za-z]{2})\b/g,
    (_, name: string, st: string) => `${name.trim()}@@${st.toUpperCase()}`,
  );
  return protected_
    .split(',')
    .map((s) => s.trim().replace(/@@/g, ', '))
    .filter(Boolean);
}

function applyLevelHint(t: GeoTarget, level?: GeoLevelHint): GeoTarget {
  if (!level || level === 'auto') return t;
  if (level === 'zip') {
    return { ...t, kind: 'zip', place: t.q.replace(/\D/g, '').slice(0, 5) || t.place };
  }
  if (level === 'state') {
    const st = t.q.toUpperCase();
    return { ...t, kind: 'state', q: st, place: st, state: st };
  }
  if (level === 'county') {
    const q = t.q.replace(/\s+county$/i, '').trim();
    return {
      ...t,
      kind: 'county',
      q,
      place: `${q.replace(/\s+/g, '_')}_County`,
    };
  }
  return { ...t, kind: 'city' };
}

/** Parse "Miami, FL" / "Harris County" / "CA" / "75001" / "Denton County, TX". */
export function parseGeoToken(token: string, level?: GeoLevelHint): GeoTarget {
  const raw = token.trim();
  const key = raw.toLowerCase().replace(/\s+/g, '_').replace(/,/g, '');
  const aliasKey = raw.toLowerCase().replace(/\s+/g, '_').replace(/,\s*/g, '_').replace(/_+/g, '_');
  const alias = GEO_ALIASES[aliasKey] || GEO_ALIASES[key];
  if (alias && !Array.isArray(alias)) {
    return applyLevelHint({ ...alias, raw }, level);
  }

  // ZIP
  if (/^\d{5}(-\d{4})?$/.test(raw) || level === 'zip') {
    const zip = raw.replace(/\D/g, '').slice(0, 5);
    return { kind: 'zip', q: zip, place: zip, raw };
  }

  const stateOnly = raw.toUpperCase();
  if (raw.length === 2 && US_STATES.has(stateOnly)) {
    return applyLevelHint({ kind: 'state', q: stateOnly, place: stateOnly, state: stateOnly, raw }, level);
  }

  const withState = raw.match(/^(.+?)[,\s]+([A-Za-z]{2})$/);
  if (withState) {
    const placeName = withState[1]!.trim();
    const st = withState[2]!.toUpperCase();
    if (US_STATES.has(st)) {
      const isCounty = /county$/i.test(placeName) || level === 'county';
      const q = placeName.replace(/\s+county$/i, '').trim();
      const base: GeoTarget = {
        kind: isCounty ? 'county' : 'city',
        q,
        place: isCounty ? `${q.replace(/\s+/g, '_')}_County` : placeName.replace(/\s+/g, '_'),
        state: st,
        raw,
      };
      return applyLevelHint(base, level);
    }
  }

  const isCounty = /county$/i.test(raw) || level === 'county';
  const q = raw.replace(/\s+county$/i, '').trim();
  const base: GeoTarget = {
    kind: isCounty ? 'county' : 'city',
    q,
    place: isCounty ? `${q.replace(/\s+/g, '_')}_County` : raw.replace(/\s+/g, '_'),
    raw,
  };
  return applyLevelHint(base, level);
}

export function resolveGeoTargets(input: {
  geos?: string;
  place?: string;
  city?: string;
  state?: string;
  /** Force every token to this level (county|city|zip|state). */
  geo_level?: GeoLevelHint;
}): GeoTarget[] {
  const chunks: string[] = [];
  if (input.geos) chunks.push(...tokenizeGeos(input.geos));
  if (input.place) chunks.push(...tokenizeGeos(input.place));
  if (input.city) chunks.push(...tokenizeGeos(input.city));

  if (!chunks.length) {
    return [
      { ...(GEO_ALIASES.dallas as GeoTarget) },
      { ...(GEO_ALIASES.tarrant as GeoTarget) },
    ];
  }

  const out: GeoTarget[] = [];
  const seen = new Set<string>();
  const defaultState = input.state?.trim().toUpperCase() || undefined;
  const level = input.geo_level || 'auto';

  for (const token of chunks) {
    const aliasKey = token.toLowerCase().replace(/\s+/g, '_').replace(/,\s*/g, '_').replace(/_+/g, '_');
    const alias = GEO_ALIASES[aliasKey];
    if (alias && level === 'auto') {
      const list = Array.isArray(alias) ? alias : [alias];
      for (const t of list) pushUnique(out, seen, { ...t, raw: token });
      continue;
    }
    const parsed = parseGeoToken(token, level === 'auto' ? undefined : level);
    if (!parsed.state && defaultState && parsed.kind !== 'zip' && parsed.kind !== 'state') {
      parsed.state = defaultState;
    }
    pushUnique(out, seen, parsed);
  }
  return out;
}
