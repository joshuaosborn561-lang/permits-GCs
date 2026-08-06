import { config } from '../config.js';
import type { GeocodedLocation, ParsedQueryParams } from '../types.js';
import { withRetry } from './retry.js';

/**
 * Free Nominatim geocoding (OpenStreetMap). No paid dependency.
 * Respect usage policy: identify app via User-Agent, keep rate modest.
 */
export async function geocodeLocation(params: ParsedQueryParams): Promise<GeocodedLocation> {
  if (config.demoMode) {
    return demoGeocode(params);
  }

  const q =
    params.location_type === 'county' && !/county/i.test(params.location_value)
      ? `${params.location_value} County`
      : params.location_value;

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '5');
  url.searchParams.set('countrycodes', 'us');

  const results = await withRetry(
    async () => {
      const res = await fetch(url.toString(), {
        headers: {
          'User-Agent': 'SalesGlider-PropertyPMFinder/1.0 (internal-tool)',
          Accept: 'application/json',
        },
      });
      if (!res.ok) throw new Error(`Nominatim ${res.status}`);
      return (await res.json()) as NominatimResult[];
    },
    { attempts: 3, baseDelayMs: 1500, label: 'nominatim' },
  );

  if (!results.length) {
    throw new Error(`Could not geocode location: ${params.location_value}`);
  }

  const best = results[0];
  const addr = best.address ?? {};

  return {
    display_name: best.display_name,
    city: addr.city || addr.town || addr.village || addr.municipality,
    county: addr.county,
    state: addr.state,
    state_code: stateToCode(addr.state),
    latitude: Number(best.lat),
    longitude: Number(best.lon),
  };
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    postcode?: string;
  };
}

const STATE_CODES: Record<string, string> = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY',
  'District of Columbia': 'DC',
};

function stateToCode(state?: string): string | undefined {
  if (!state) return undefined;
  if (state.length === 2) return state.toUpperCase();
  return STATE_CODES[state];
}

function demoGeocode(params: ParsedQueryParams): GeocodedLocation {
  const value = params.location_value;
  const stateMatch = value.match(/,\s*([A-Z]{2})\b/);
  const state_code = stateMatch?.[1] ?? 'TX';
  const city = value.split(',')[0]?.replace(/\s+County$/i, '').trim() || 'Fort Worth';
  const isCounty = params.location_type === 'county' || /county/i.test(value);

  // Fort Worth / Dallas-ish defaults for demo; still returns a usable center point.
  const known: Record<string, { lat: number; lon: number }> = {
    'fort worth': { lat: 32.7555, lon: -97.3308 },
    dallas: { lat: 32.7767, lon: -96.797 },
    atlanta: { lat: 33.749, lon: -84.388 },
  };
  const coords = known[city.toLowerCase()] ?? { lat: 32.7555, lon: -97.3308 };

  return {
    display_name: `${value}, USA (demo geocode)`,
    city: isCounty ? undefined : city,
    county: isCounty ? city : undefined,
    state: state_code,
    state_code,
    latitude: coords.lat,
    longitude: coords.lon,
  };
}
