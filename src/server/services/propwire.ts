import { randomUUID } from 'crypto';
import { config, COST } from '../config.js';
import { runActor } from '../lib/apify.js';
import type { GeocodedLocation, ParsedQueryParams, PropertyRecord } from '../types.js';

const ACTOR_ID = 'solidcode/propwire-com-scraper';

export interface PropwirePullResult {
  properties: PropertyRecord[];
  failed: boolean;
  cost: number;
  error?: string;
}

export async function pullPropwire(opts: {
  runId: string;
  params: ParsedQueryParams;
  geo: GeocodedLocation;
}): Promise<PropwirePullResult> {
  if (config.demoMode || !config.apifyToken) {
    return demoPropwire(opts.runId, opts.params, opts.geo);
  }

  const input = buildPropwireInput(opts.params, opts.geo);

  try {
    const items = await runActor<Record<string, unknown>>(ACTOR_ID, input, {
      label: 'propwire',
    });

    const properties = items.slice(0, opts.params.max_records).map((item) => mapPropwireItem(opts.runId, item));
    return {
      properties,
      failed: false,
      cost: properties.length * COST.propwirePerRecord,
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

  if (params.location_type === 'radius') {
    return {
      ...base,
      latitude: geo.latitude,
      longitude: geo.longitude,
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
  const state = geo.state_code || 'TX';

  const properties: PropertyRecord[] = Array.from({ length: n }, (_, i) => {
    const hasCo = i % 3 === 0;
    const owner = hasCo
      ? `FW Industrial Holdings ${i + 1} LLC`
      : i % 2 === 0
        ? `Smith Family Trust ${i + 1}`
        : `Jane Owner ${i + 1}`;
    const co = hasCo ? `Metro Property Management Group` : null;
    const street = `${100 + i * 10} Commerce St`;

    return {
      id: randomUUID(),
      run_id: runId,
      address: `${street}, ${city}, ${state}`,
      city,
      state,
      zip: '76102',
      latitude: geo.latitude + i * 0.001,
      longitude: geo.longitude - i * 0.001,
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
      raw_propwire_data: { demo: true, index: i },
    };
  });

  return {
    properties,
    failed: false,
    cost: properties.length * COST.propwirePerRecord,
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
