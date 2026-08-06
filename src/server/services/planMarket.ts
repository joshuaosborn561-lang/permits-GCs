import { estimateCost } from '../lib/costs.js';
import { applyGeoToParams, parseExcludeCategories, resolveGeography } from '../lib/zips.js';
import type { CostEstimate, ParsedQueryParams } from '../types.js';
import { applyPlanOverrides, parseNaturalLanguageQuery } from './parseQuery.js';

export interface PlanMarketInput {
  query?: string;
  /** Existing parsed params (skip NL parse when set with no query). */
  params?: ParsedQueryParams;
  zips?: string | string[] | null;
  center?: string | null;
  radius_miles?: number | null;
  exclude_categories?: string | string[] | null;
  max_records?: number | null;
  location_type?: ParsedQueryParams['location_type'];
  location_value?: string;
}

export interface PlanMarketResult {
  parsed: ParsedQueryParams;
  estimate: CostEstimate;
  zip_count: number;
  states: string[];
  center: string | null;
  radius_miles: number | null;
  mode: 'zips' | 'radius' | 'area';
}

/**
 * Parse (optional) + apply overrides + resolve ZIP geography + cost estimate.
 * Explicit `zips` wins; then center+radius; then city/county.
 */
export async function planMarket(input: PlanMarketInput): Promise<PlanMarketResult> {
  let base: ParsedQueryParams;

  if (input.query?.trim()) {
    base = await parseNaturalLanguageQuery(input.query.trim());
  } else if (input.params) {
    base = { ...input.params };
  } else if (input.location_type && input.location_value) {
    base = {
      location_type: input.location_type,
      location_value: input.location_value,
      radius_miles: input.location_type === 'radius' ? input.radius_miles ?? 50 : null,
      center: input.center ?? (input.location_type === 'radius' ? input.location_value : null),
      center_lat: null,
      center_lng: null,
      property_type: 'commercial',
      max_records: input.max_records ?? 5000,
      ambiguous: false,
      ambiguity_options: [],
      ambiguity_reason: null,
      zips: [],
      zip_count: 0,
      zips_csv: null,
      zips_explicit: false,
      exclude_categories: parseExcludeCategories(input.exclude_categories),
      states: [],
    };
  } else {
    throw new Error('Provide query, params, or location_type + location_value');
  }

  const withOverrides = applyPlanOverrides(base, {
    zips: input.zips,
    center: input.center,
    radius_miles: input.radius_miles,
    exclude_categories: input.exclude_categories,
    max_records: input.max_records,
  });

  const geo = await resolveGeography(withOverrides);
  const parsed = applyGeoToParams(withOverrides, geo);
  const estimate = estimateCost(parsed);

  return {
    parsed,
    estimate,
    zip_count: parsed.zip_count ?? geo.zip_count,
    states: parsed.states ?? geo.states,
    center: parsed.center ?? null,
    radius_miles: parsed.radius_miles ?? null,
    mode: geo.mode,
  };
}
