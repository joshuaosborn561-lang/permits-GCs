import { config } from '../config.js';
import { structuredExtract } from '../lib/openai.js';
import type { ParsedQueryParams } from '../types.js';

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    location_type: { type: 'string', enum: ['city', 'radius', 'county'] },
    location_value: { type: 'string' },
    radius_miles: { type: ['number', 'null'] },
    property_type: { type: 'string', enum: ['commercial'] },
    max_records: { type: 'integer' },
    ambiguous: { type: 'boolean' },
    ambiguity_options: {
      type: 'array',
      items: { type: 'string' },
    },
    ambiguity_reason: { type: ['string', 'null'] },
  },
  required: [
    'location_type',
    'location_value',
    'radius_miles',
    'property_type',
    'max_records',
    'ambiguous',
    'ambiguity_options',
    'ambiguity_reason',
  ],
} as const;

export async function parseNaturalLanguageQuery(query: string): Promise<ParsedQueryParams> {
  if (config.demoMode || !config.openaiApiKey) {
    return heuristicParse(query);
  }

  try {
    const result = await structuredExtract<ParsedQueryParams>({
      step: 'parse_query',
      schemaName: 'parsed_location_query',
      schema: schema as unknown as Record<string, unknown>,
      system: `You parse natural language requests for commercial property owner pulls in the United States.
Return structured JSON only.
Rules:
- Default property_type to commercial.
- Default max_records to 5000 unless the user specifies a number.
- location_type city for city/metro, county for county, radius when a miles-from-point request is made.
- location_value should include city/county and state when possible (e.g. "Fort Worth, TX").
- If the location is ambiguous (city name exists in multiple states, missing state, unclear county), set ambiguous=true and provide 2-4 ambiguity_options the user can pick from. Do not silently guess.
- If not ambiguous, ambiguous=false and ambiguity_options=[].`,
      user: query,
    });

    return normalizeParsed(result);
  } catch {
    return heuristicParse(query);
  }
}

function normalizeParsed(p: ParsedQueryParams): ParsedQueryParams {
  return {
    location_type: p.location_type,
    location_value: p.location_value,
    radius_miles: p.location_type === 'radius' ? p.radius_miles ?? 50 : null,
    property_type: 'commercial',
    max_records: Math.min(Math.max(p.max_records || 5000, 1), 50000),
    ambiguous: Boolean(p.ambiguous),
    ambiguity_options: p.ambiguity_options ?? [],
    ambiguity_reason: p.ambiguity_reason ?? null,
  };
}

/** Offline / demo fallback parser */
export function heuristicParse(query: string): ParsedQueryParams {
  const q = query.trim();
  const maxMatch = q.match(/(\d{2,5})\s*(records|properties|leads)?/i);
  const max_records = maxMatch ? Math.min(Number(maxMatch[1]), 50000) : 5000;

  const radiusMatch = q.match(/within\s+(\d+)\s*miles?\s+of\s+(.+?)(?:\.|$)/i);
  if (radiusMatch) {
    const location_value = radiusMatch[2].replace(/\.$/, '').trim();
    const ambiguous = !/,\s*[A-Z]{2}\b/.test(location_value) && !/\b[A-Z]{2}\b/.test(location_value);
    return {
      location_type: 'radius',
      location_value,
      radius_miles: Number(radiusMatch[1]),
      property_type: 'commercial',
      max_records,
      ambiguous,
      ambiguity_options: ambiguous
        ? [`${location_value}, TX`, `${location_value}, CA`, `${location_value}, GA`]
        : [],
      ambiguity_reason: ambiguous ? 'City without a clear state abbreviation' : null,
    };
  }

  const countyMatch = q.match(/in\s+([A-Za-z .]+?\s+County),?\s*([A-Z]{2})?/i);
  if (countyMatch) {
    const county = countyMatch[1].trim();
    const state = countyMatch[2];
    const location_value = state ? `${county}, ${state}` : county;
    return {
      location_type: 'county',
      location_value,
      radius_miles: null,
      property_type: 'commercial',
      max_records,
      ambiguous: !state,
      ambiguity_options: !state
        ? [`${county}, GA`, `${county}, TX`, `${county}, FL`]
        : [],
      ambiguity_reason: !state ? 'County without a state' : null,
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

  return {
    location_type: 'city',
    location_value,
    radius_miles: null,
    property_type: 'commercial',
    max_records,
    ambiguous,
    ambiguity_options: ambiguous
      ? [`${location_value}, TX`, `${location_value}, CA`, `${location_value}, GA`]
      : [],
    ambiguity_reason: ambiguous
      ? 'Did you mean a specific state? City names can exist in multiple states.'
      : null,
  };
}
