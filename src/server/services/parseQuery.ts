import { config } from '../config.js';
import { structuredExtract } from '../lib/openai.js';
import { parseExcludeCategories, parseZipList } from '../lib/zips.js';
import type { ParsedQueryParams } from '../types.js';

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    location_type: { type: 'string', enum: ['city', 'radius', 'county', 'zips'] },
    location_value: { type: 'string' },
    radius_miles: { type: ['number', 'null'] },
    center: { type: ['string', 'null'] },
    property_type: { type: 'string', enum: ['commercial'] },
    max_records: { type: 'integer' },
    ambiguous: { type: 'boolean' },
    ambiguity_options: {
      type: 'array',
      items: { type: 'string' },
    },
    ambiguity_reason: { type: ['string', 'null'] },
    exclude_categories: {
      type: 'array',
      items: { type: 'string' },
    },
    states: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: [
    'location_type',
    'location_value',
    'radius_miles',
    'center',
    'property_type',
    'max_records',
    'ambiguous',
    'ambiguity_options',
    'ambiguity_reason',
    'exclude_categories',
    'states',
  ],
} as const;

export async function parseNaturalLanguageQuery(query: string): Promise<ParsedQueryParams> {
  if (config.demoMode || !config.openaiApiKey) {
    return heuristicParse(query);
  }

  try {
    const result = await structuredExtract<ParsedQueryParams & { center?: string | null }>({
      step: 'parse_query',
      schemaName: 'parsed_location_query',
      schema: schema as unknown as Record<string, unknown>,
      system: `You parse natural language requests for commercial property owner pulls in the United States.
Return structured JSON only.

Geography rules (critical — do not widen markets):
- If the brief says "within N miles of X" / "N-mile radius of X" / "around X within N miles", set location_type="radius", center to that place (include state when known, e.g. "Dallas, TX"), radius_miles=N, and location_value=center. states should be ONLY the state of the center (e.g. ["TX"] for Dallas TX). NEVER expand a radius brief into neighboring states (do not add OK for a DFW radius).
- If the brief is city-only (no miles), location_type="city".
- If the brief is a county, location_type="county".
- Do not invent a multi-state region unless the user explicitly named multiple states.

Category exclusion rules:
- If the brief says "do not include X", "exclude X", "not X", "no X contractors", put those niches in exclude_categories (lowercase).
- exclude_categories must NOT appear as positive targets.

Other rules:
- Default property_type to commercial.
- Default max_records to 5000 unless the user specifies a number.
- location_value should include city/county and state when possible (e.g. "Fort Worth, TX").
- If the location is ambiguous (city name exists in multiple states, missing state, unclear county), set ambiguous=true and provide 2-4 ambiguity_options. Do not silently guess.
- If not ambiguous, ambiguous=false and ambiguity_options=[].`,
      user: query,
    });

    return normalizeParsed(result, query);
  } catch {
    return heuristicParse(query);
  }
}

function normalizeParsed(
  p: ParsedQueryParams & { center?: string | null },
  originalQuery?: string,
): ParsedQueryParams {
  const radiusHint = originalQuery?.match(/within\s+(\d+)\s*miles?\s+of\s+(.+?)(?:\.|$|,|\s+—)/i);
  let location_type = p.location_type;
  let radius_miles = p.radius_miles;
  let center = (p.center || '').trim() || null;
  let location_value = p.location_value;

  // Hard preference: radius phrasing in the brief wins over a widened city/state parse.
  if (radiusHint) {
    location_type = 'radius';
    radius_miles = Number(radiusHint[1]);
    const fromBrief = radiusHint[2].replace(/\.$/, '').trim();
    center = center || fromBrief;
    location_value = center;
  }

  if (location_type === 'radius') {
    radius_miles = radius_miles ?? 50;
    center = center || location_value;
    location_value = center;
  } else {
    radius_miles = null;
  }

  const states = (p.states ?? [])
    .map((s) => String(s).trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));

  // For a radius around a place that includes a state, force single-state.
  const stateFromCenter = (center || location_value).match(/\b([A-Z]{2})\b/);
  const finalStates =
    location_type === 'radius' && stateFromCenter
      ? [stateFromCenter[1]!]
      : states;

  return {
    location_type,
    location_value,
    radius_miles,
    center,
    center_lat: null,
    center_lng: null,
    property_type: 'commercial',
    max_records: Math.min(Math.max(p.max_records || 5000, 1), 50000),
    ambiguous: Boolean(p.ambiguous),
    ambiguity_options: p.ambiguity_options ?? [],
    ambiguity_reason: p.ambiguity_reason ?? null,
    exclude_categories: parseExcludeCategories(p.exclude_categories),
    states: finalStates,
    zips: [],
    zip_count: 0,
    zips_csv: null,
  };
}

/** Offline / demo fallback parser */
export function heuristicParse(query: string): ParsedQueryParams {
  const q = query.trim();
  const maxMatch = q.match(/(\d{2,5})\s*(records|properties|leads)?/i);
  const max_records = maxMatch ? Math.min(Number(maxMatch[1]), 50000) : 5000;

  const exclude: string[] = [];
  for (const m of q.matchAll(
    /(?:do not include|don't include|exclude|not include|no)\s+([a-z0-9 /,&-]+?)(?:\s+themselves)?(?:\.|,|;|$)/gi,
  )) {
    exclude.push(...parseExcludeCategories(m[1]));
  }

  const zipList = parseZipList(
    (q.match(/\bzips?\s*[:=]\s*([0-9,\s]+)/i)?.[1] ?? '') ||
      (q.match(/\b(\d{5}(?:\s*,\s*\d{5}){1,})\b/)?.[1] ?? ''),
  );

  if (zipList.length) {
    return {
      location_type: 'zips',
      location_value: zipList.join(', '),
      radius_miles: null,
      center: null,
      center_lat: null,
      center_lng: null,
      property_type: 'commercial',
      max_records,
      ambiguous: false,
      ambiguity_options: [],
      ambiguity_reason: null,
      zips: zipList,
      zip_count: zipList.length,
      zips_csv: zipList.join(','),
      exclude_categories: exclude,
      states: [],
    };
  }

  const radiusMatch = q.match(/within\s+(\d+)\s*miles?\s+of\s+(.+?)(?:\.|$)/i);
  if (radiusMatch) {
    let location_value = radiusMatch[2].replace(/\.$/, '').trim();
    // Strip trailing junk like "Texas — 100 records"
    location_value = location_value.split(/[—-]/)[0]!.trim();
    const stateMatch = location_value.match(/\b([A-Z]{2})\b/) || location_value.match(/\b(Texas|California|Georgia)\b/i);
    let states: string[] = [];
    if (stateMatch) {
      const raw = stateMatch[1]!;
      const map: Record<string, string> = { Texas: 'TX', California: 'CA', Georgia: 'GA' };
      states = [map[raw] ?? raw.toUpperCase()];
      if (!/\b[A-Z]{2}\b/.test(location_value) && states[0]) {
        location_value = `${location_value.replace(/\b(Texas|California|Georgia)\b/i, '').trim()}, ${states[0]}`
          .replace(/\s+,/g, ',')
          .replace(/,\s*,/g, ',')
          .trim();
      }
    }
    const ambiguous = !states.length && !/,\s*[A-Z]{2}\b/.test(location_value);
    return {
      location_type: 'radius',
      location_value,
      radius_miles: Number(radiusMatch[1]),
      center: location_value,
      center_lat: null,
      center_lng: null,
      property_type: 'commercial',
      max_records,
      ambiguous,
      ambiguity_options: ambiguous
        ? [`${location_value}, TX`, `${location_value}, CA`, `${location_value}, GA`]
        : [],
      ambiguity_reason: ambiguous ? 'City without a clear state abbreviation' : null,
      exclude_categories: exclude,
      states,
      zips: [],
      zip_count: 0,
      zips_csv: null,
    };
  }

  const countyMatch = q.match(/in\s+([A-Za-z .]+?\s+County),?\s*([A-Z]{2})?/i);
  if (countyMatch) {
    const county = countyMatch[1]!.trim();
    const state = countyMatch[2];
    const location_value = state ? `${county}, ${state}` : county;
    return {
      location_type: 'county',
      location_value,
      radius_miles: null,
      center: null,
      center_lat: null,
      center_lng: null,
      property_type: 'commercial',
      max_records,
      ambiguous: !state,
      ambiguity_options: !state
        ? [`${county}, GA`, `${county}, TX`, `${county}, FL`]
        : [],
      ambiguity_reason: !state ? 'County without a state' : null,
      exclude_categories: exclude,
      states: state ? [state] : [],
      zips: [],
      zip_count: 0,
      zips_csv: null,
    };
  }

  const cityMatch =
    q.match(/\bin\s+([A-Za-z .]+?,\s*[A-Z]{2})\b/i) ||
    q.match(/\bin\s+([A-Za-z .]+?)(?:\s*[—-].*)?$/i) ||
    q.match(/(?:owners?|properties)\s+([A-Za-z .]+)$/i);

  let location_value = cityMatch?.[1]?.trim() ?? 'Fort Worth, TX';
  location_value = location_value
    .replace(/^all\s+/i, '')
    .replace(/^in\s+/i, '')
    .replace(/\.$/, '')
    .trim();

  const hasState = /,\s*[A-Z]{2}\b/.test(location_value);
  const ambiguous = !hasState;
  const state = location_value.match(/,\s*([A-Z]{2})\b/)?.[1];

  return {
    location_type: 'city',
    location_value,
    radius_miles: null,
    center: null,
    center_lat: null,
    center_lng: null,
    property_type: 'commercial',
    max_records,
    ambiguous,
    ambiguity_options: ambiguous
      ? [`${location_value}, TX`, `${location_value}, CA`, `${location_value}, GA`]
      : [],
    ambiguity_reason: ambiguous
      ? 'Did you mean a specific state? City names can exist in multiple states.'
      : null,
    exclude_categories: exclude,
    states: state ? [state] : [],
    zips: [],
    zip_count: 0,
    zips_csv: null,
  };
}

/** Merge explicit tool overrides (zips / center / radius / excludes) onto a parsed plan. */
export function applyPlanOverrides(
  base: ParsedQueryParams,
  overrides: {
    zips?: string | string[] | null;
    center?: string | null;
    radius_miles?: number | null;
    exclude_categories?: string | string[] | null;
    max_records?: number | null;
  },
): ParsedQueryParams {
  const zips = parseZipList(overrides.zips);
  const exclude = [
    ...parseExcludeCategories(base.exclude_categories),
    ...parseExcludeCategories(overrides.exclude_categories),
  ];
  const seen = new Set<string>();
  const exclude_categories = exclude.filter((c) => (seen.has(c) ? false : (seen.add(c), true)));

  let next: ParsedQueryParams = {
    ...base,
    exclude_categories,
  };

  if (overrides.max_records != null && Number.isFinite(overrides.max_records)) {
    next.max_records = Math.min(Math.max(Number(overrides.max_records), 1), 50000);
  }

  if (zips.length) {
    next = {
      ...next,
      location_type: 'zips',
      location_value: zips.join(', '),
      zips,
      zips_csv: zips.join(','),
      zip_count: zips.length,
      radius_miles: overrides.radius_miles ?? next.radius_miles,
      center: overrides.center ?? next.center,
    };
    return next;
  }

  if (overrides.center || overrides.radius_miles != null) {
    const center = (overrides.center || next.center || next.location_value || '').trim();
    const radius_miles = overrides.radius_miles ?? next.radius_miles ?? 50;
    next = {
      ...next,
      location_type: 'radius',
      location_value: center,
      center,
      radius_miles,
    };
  }

  return next;
}
