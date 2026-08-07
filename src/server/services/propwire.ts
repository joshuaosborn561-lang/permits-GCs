import { randomUUID } from 'crypto';
import { config, COST } from '../config.js';
import { runActor } from '../lib/apify.js';
import { haversineMiles, matchesExcludedCategory } from '../lib/zips.js';
import type { GeocodedLocation, ParsedQueryParams, PropertyRecord } from '../types.js';

const ACTOR_ID = 'solidcode/propwire-com-scraper';

export interface PropwirePullResult {
  properties: PropertyRecord[];
  failed: boolean;
  cost: number;
  error?: string;
  zips_scraped?: string[];
}

export async function pullPropwire(opts: {
  runId: string;
  params: ParsedQueryParams;
  geo: GeocodedLocation;
}): Promise<PropwirePullResult> {
  if (config.demoMode || !config.apifyToken) {
    return demoPropwire(opts.runId, opts.params, opts.geo);
  }

  try {
    let items: Record<string, unknown>[] = [];
    let zips_scraped: string[] | undefined;

    // Only scrape ZIP-by-ZIP when the caller explicitly supplied zips.
    // Radius footprints also populate `zips` for reporting — those must use one
    // native lat/lng + radiusMiles Propwire search, not hundreds of actor runs.
    const scrapeByZip =
      Boolean(opts.params.zips_explicit) &&
      Boolean(opts.params.zips?.length) &&
      opts.params.location_type === 'zips';

    if (scrapeByZip) {
      zips_scraped = opts.params.zips;
      const perZip = Math.max(1, Math.ceil(opts.params.max_records / opts.params.zips!.length));
      for (const zip of opts.params.zips!) {
        if (items.length >= opts.params.max_records) break;
        const batch = await runActor<Record<string, unknown>>(
          ACTOR_ID,
          {
            propertyType: 'commercial',
            maxItems: Math.min(perZip, opts.params.max_records - items.length),
            enrichDetails: true,
            zipCode: zip,
          },
          { label: `propwire-zip-${zip}` },
        );
        items.push(...batch);
      }
    } else {
      const input = buildPropwireInput(opts.params, opts.geo);
      items = await runActor<Record<string, unknown>>(ACTOR_ID, input, {
        label: 'propwire',
      });
    }

    let properties = items
      .slice(0, opts.params.max_records)
      .map((item) => mapPropwireItem(opts.runId, item));

    properties = filterProperties(properties, opts.params);

    return {
      properties,
      failed: false,
      cost: properties.length * COST.propwirePerRecord,
      zips_scraped,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[propwire] batch failed', message);
    return {
      properties: [],
      failed: true,
      cost: 0,
      error: message,
    };
  }
}

function buildPropwireInput(
  params: ParsedQueryParams,
  geo: GeocodedLocation,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    propertyType: 'commercial',
    maxItems: params.max_records,
    enrichDetails: true,
  };

  if (
    params.location_type === 'radius' ||
    (params.center_lat != null && params.center_lng != null && params.radius_miles)
  ) {
    return {
      ...base,
      latitude: params.center_lat ?? geo.latitude,
      longitude: params.center_lng ?? geo.longitude,
      radiusMiles: params.radius_miles ?? 50,
    };
  }

  if (params.location_type === 'county') {
    return {
      ...base,
      county: geo.county || params.location_value.split(',')[0],
      state: geo.state_code || geo.state,
    };
  }

  return {
    ...base,
    city: geo.city || params.location_value.split(',')[0],
    state: geo.state_code || geo.state,
  };
}

export function filterProperties(
  properties: PropertyRecord[],
  params: ParsedQueryParams,
): PropertyRecord[] {
  let out = properties;

  // Only hard-filter to the ZIP allowlist for explicit ZIP pulls.
  // Radius footprints use haversine below instead (Propwire radius can return
  // parcels whose USPS ZIP isn't in our STANDARD centroid table).
  if (params.zips_explicit && params.zips?.length) {
    const allow = new Set(params.zips);
    out = out.filter((p) => !p.zip || allow.has(p.zip));
  }

  if (
    params.radius_miles &&
    params.center_lat != null &&
    params.center_lng != null
  ) {
    out = out.filter((p) => {
      if (p.latitude == null || p.longitude == null) return true;
      return (
        haversineMiles(params.center_lat!, params.center_lng!, p.latitude, p.longitude) <=
        (params.radius_miles ?? 0)
      );
    });
  }

  if (params.exclude_categories?.length) {
    out = out.filter((p) => {
      const hay = [
        p.building_name,
        p.owner_entity_name,
        p.property_manager_company,
        JSON.stringify(p.raw_propwire_data ?? {}),
      ]
        .filter(Boolean)
        .join(' ');
      return !matchesExcludedCategory(hay, params.exclude_categories!);
    });
  }

  return out;
}

function mapPropwireItem(runId: string, item: Record<string, unknown>): PropertyRecord {
  const address =
    str(item.address) ||
    str(item.propertyAddress) ||
    str(item.streetAddress) ||
    [str(item.street), str(item.city), str(item.state), str(item.zip)].filter(Boolean).join(', ');

  const mailing =
    str(item.mailingAddress) ||
    str(item.ownerMailingAddress) ||
    str(item.mailAddress) ||
    [
      str(item.ownerName),
      str(item.mailStreet),
      str(item.mailCity),
      str(item.mailState),
      str(item.mailZip),
    ]
      .filter(Boolean)
      .join(', ');

  return {
    id: randomUUID(),
    run_id: runId,
    address: address || null,
    city: str(item.city) || null,
    state: str(item.state) || null,
    zip: str(item.zip) || str(item.zipCode) || null,
    latitude: num(item.latitude) ?? num(item.lat),
    longitude: num(item.longitude) ?? num(item.lng) ?? num(item.lon),
    building_name: str(item.buildingName) || str(item.propertyName) || null,
    owner_entity_name: str(item.ownerName) || str(item.owner) || null,
    owner_type: null,
    care_of_company: null,
    is_likely_self_managed: null,
    property_manager_company: null,
    pm_confidence: null,
    pm_source: null,
    mailing_address_raw: mailing || null,
    status: 'pending',
    raw_propwire_data: item,
  };
}

function demoPropwire(
  runId: string,
  params: ParsedQueryParams,
  geo: GeocodedLocation,
): PropwirePullResult {
  const n = Math.min(params.max_records, 25);
  const city = geo.city || params.location_value.split(',')[0] || 'Fort Worth';
  const state = geo.state_code || params.states?.[0] || 'TX';
  const zipPool = params.zips?.length ? params.zips : ['76102', '75001', '75002'];

  const properties: PropertyRecord[] = Array.from({ length: n }, (_, i) => {
    const hasCo = i % 3 === 0;
    const owner = hasCo
      ? `FW Industrial Holdings ${i + 1} LLC`
      : i % 2 === 0
        ? `Smith Family Trust ${i + 1}`
        : `Jane Owner ${i + 1}`;
    const co = hasCo ? `Metro Property Management Group` : null;
    const street = `${100 + i * 10} Commerce St`;
    const zip = zipPool[i % zipPool.length]!;

    return {
      id: randomUUID(),
      run_id: runId,
      address: `${street}, ${city}, ${state}`,
      city,
      state,
      zip,
      latitude: (params.center_lat ?? geo.latitude) + i * 0.001,
      longitude: (params.center_lng ?? geo.longitude) - i * 0.001,
      building_name: i % 4 === 0 ? `${city} Commerce Center ${i + 1}` : null,
      owner_entity_name: owner,
      owner_type: null,
      care_of_company: null,
      is_likely_self_managed: null,
      property_manager_company: null,
      pm_confidence: null,
      pm_source: null,
      mailing_address_raw: hasCo
        ? `${owner}, c/o ${co}, 500 Main St, ${city}, ${state} 76102`
        : `${owner}, ${street}, ${city}, ${state} 76102`,
      status: 'pending',
      raw_propwire_data: { demo: true, index: i, zip },
    };
  });

  return {
    properties: filterProperties(properties, params),
    failed: false,
    cost: properties.length * COST.propwirePerRecord,
    zips_scraped: params.zips?.length ? params.zips : undefined,
  };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}
