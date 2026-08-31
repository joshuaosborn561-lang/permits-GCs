/**
 * Shared Shovels geography tokens for estimates + live pulls.
 * Nationwide — not TX-only. Coast aliases expand to major metros (not whole coasts)
 * so credit spend stays controllable; pass a state code (CA, FL, …) for statewide.
 */

export type GeoTarget = {
  kind: 'city' | 'county' | 'state';
  q: string;
  place: string;
  state?: string;
};

const GEO_ALIASES: Record<string, GeoTarget | GeoTarget[]> = {
  dallas: { kind: 'city', q: 'Dallas', place: 'Dallas', state: 'TX' },
  dallas_city: { kind: 'city', q: 'Dallas', place: 'Dallas', state: 'TX' },
  dallas_county: { kind: 'county', q: 'Dallas', place: 'Dallas_County', state: 'TX' },
  fort_worth: { kind: 'county', q: 'Tarrant', place: 'Fort_Worth', state: 'TX' },
  fortworth: { kind: 'county', q: 'Tarrant', place: 'Fort_Worth', state: 'TX' },
  tarrant: { kind: 'county', q: 'Tarrant', place: 'Fort_Worth', state: 'TX' },
  tarrant_county: { kind: 'county', q: 'Tarrant', place: 'Fort_Worth', state: 'TX' },
  rockwall: { kind: 'county', q: 'Rockwall', place: 'Rockwall_County', state: 'TX' },
  rockwall_county: { kind: 'county', q: 'Rockwall', place: 'Rockwall_County', state: 'TX' },
  houston: { kind: 'city', q: 'Houston', place: 'Houston', state: 'TX' },
  harris: { kind: 'county', q: 'Harris', place: 'Harris', state: 'TX' },
  harris_county: { kind: 'county', q: 'Harris', place: 'Harris', state: 'TX' },
  austin: { kind: 'city', q: 'Austin', place: 'Austin', state: 'TX' },
  san_antonio: { kind: 'city', q: 'San Antonio', place: 'San_Antonio', state: 'TX' },

  // West coast metros (Cayden can also pass CA / WA / OR as state codes)
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

  // East coast metros
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

/** Parse "Miami, FL" / "Miami FL" / "Harris County" / "CA". */
export function parseGeoToken(token: string): GeoTarget {
  const raw = token.trim();
  const key = raw.toLowerCase().replace(/\s+/g, '_');
  const alias = GEO_ALIASES[key];
  if (alias && !Array.isArray(alias)) return { ...alias };

  const stateOnly = raw.toUpperCase();
  if (raw.length === 2 && US_STATES.has(stateOnly)) {
    return { kind: 'state', q: stateOnly, place: stateOnly, state: stateOnly };
  }

  const withState = raw.match(/^(.+?)[,\s]+([A-Za-z]{2})$/);
  if (withState) {
    const placeName = withState[1]!.trim();
    const st = withState[2]!.toUpperCase();
    if (US_STATES.has(st)) {
      const isCounty = /county$/i.test(placeName);
      const q = placeName.replace(/\s+county$/i, '').trim();
      return {
        kind: isCounty ? 'county' : 'city',
        q,
        place: placeName.replace(/\s+/g, '_'),
        state: st,
      };
    }
  }

  const isCounty = /county$/i.test(raw);
  return {
    kind: isCounty ? 'county' : 'city',
    q: raw.replace(/\s+county$/i, '').trim(),
    place: raw.replace(/\s+/g, '_'),
  };
}

export function resolveGeoTargets(input: {
  geos?: string;
  place?: string;
  city?: string;
  state?: string;
}): GeoTarget[] {
  const raw = [input.geos, input.place, input.city]
    .filter(Boolean)
    .join(',')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!raw.length) {
    return [
      GEO_ALIASES.dallas as GeoTarget,
      GEO_ALIASES.tarrant as GeoTarget,
    ];
  }

  const out: GeoTarget[] = [];
  const seen = new Set<string>();
  const defaultState = input.state?.trim().toUpperCase() || undefined;

  for (const token of raw) {
    const key = token.toLowerCase().replace(/\s+/g, '_');
    const alias = GEO_ALIASES[key];
    if (alias) {
      const list = Array.isArray(alias) ? alias : [alias];
      for (const t of list) pushUnique(out, seen, { ...t });
      continue;
    }
    const parsed = parseGeoToken(token);
    if (!parsed.state && defaultState) parsed.state = defaultState;
    pushUnique(out, seen, parsed);
  }
  return out;
}
