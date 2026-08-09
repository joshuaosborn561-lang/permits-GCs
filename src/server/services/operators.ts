/**
 * Operator rollup: group commercial parcels by normalised mailing address.
 *
 * Entity names like "7759 RONNIE LLC" are useless shells; the tax-bill mailing
 * address collapses many LLCs into one real operator. Returns counts only —
 * never rows — after writing to permit_parcel.operators via RPC.
 */

import { getSupabase, hasSupabase, ingestSecret } from '../lib/supabase.js';
import { supabaseProjectRef } from '../lib/supabaseTarget.js';
import { loadParcels } from './parcels.js';
import { MUNICIPAL_RE } from './ownerType.js';

export type BuildOperatorsInput = {
  min_parcels?: number;
  min_llcs?: number;
  min_portfolio_value?: number;
  exclude_out_of_state?: boolean;
  exclude_municipal?: boolean;
  exclude_tax_departments?: boolean;
  /** Comma-separated home-state codes, e.g. "TX". Used when exclude_out_of_state. */
  home_states?: string;
  target_schema?: string;
  target_table?: string;
};

export type BuildOperatorsResult = {
  ok: true;
  operators_built: number;
  parcels_covered: number;
  distinct_llcs_covered: number;
  portfolio_value_total: number;
  filters: Required<
    Pick<
      BuildOperatorsInput,
      | 'min_parcels'
      | 'min_llcs'
      | 'min_portfolio_value'
      | 'exclude_out_of_state'
      | 'exclude_municipal'
      | 'exclude_tax_departments'
      | 'home_states'
      | 'target_schema'
      | 'target_table'
    >
  >;
  source_parcel_count: number;
  excluded: {
    no_mailing: number;
    out_of_state: number;
    municipal: number;
    tax_department: number;
  };
  supabase_project: string | null;
  supabase_schema: string;
  verify_sql: string[];
  assistant_instructions: string;
};

const CARE_OF_RE = /^\s*(?:%|C\/O|C\/0|CARE\s+OF|ATTN:?|ATTENTION:?)\s+/i;

const TAX_DEPT_RE =
  /\b(TAX\s+DEPT|TAX\s+DEPARTMENT|TAX\s+TEAM|INDIRECT\s+TAX|PROPERTY\s+TAX|REAL\s+ESTATE\s+TAX|TAX\s+DIVISION)\b/i;

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

const US_STATE_NAMES: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
  COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA',
  HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS',
  KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT',
  NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND',
  OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX',
  UTAH: 'UT', VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI', WYOMING: 'WY', 'DISTRICT OF COLUMBIA': 'DC',
};

/** Strip care-of prefixes; collapse whitespace; uppercase for grouping. */
export function normalizeMailingAddress(raw: string | null | undefined): {
  key: string;
  display: string;
} | null {
  if (!raw) return null;
  let s = String(raw).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(CARE_OF_RE, '').trim();
  }
  if (!s) return null;
  const key = s.toUpperCase().replace(/\s+/g, ' ').trim();
  return { key, display: s };
}

/** Extract a 2-letter state from the end of a US mailing address. */
export function extractMailingState(address: string): string | null {
  const upper = address.toUpperCase().replace(/\s+/g, ' ').trim();
  const codeMatch = upper.match(/[,\s]([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$/);
  if (codeMatch && US_STATE_CODES.has(codeMatch[1]!)) return codeMatch[1]!;
  const codeOnly = upper.match(/[,\s]([A-Z]{2})\s*$/);
  if (codeOnly && US_STATE_CODES.has(codeOnly[1]!)) return codeOnly[1]!;
  for (const [name, code] of Object.entries(US_STATE_NAMES)) {
    const re = new RegExp(`(?:^[\\s,]|\\s)${name}\\s+(?:\\d{5}|$)`, 'i');
    if (re.test(upper)) return code;
  }
  return null;
}

export function isTaxDepartmentAddress(address: string): boolean {
  return TAX_DEPT_RE.test(address);
}

export function isMunicipalOwnerName(ownerName: string | null | undefined): boolean {
  return MUNICIPAL_RE.test(ownerName ?? '');
}

function parseHomeStates(raw: string | undefined): Set<string> {
  const parts = (raw ?? 'TX')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return new Set(parts.length ? parts : ['TX']);
}

type Agg = {
  display: string;
  parcels: number;
  llcs: Set<string>;
  portfolioValue: number;
  largestParcelValue: number;
  counties: Set<string>;
  topLlc: string;
  topLlcValue: number;
  topParcelAddress: string;
  topParcelValue: number;
  hasLocalLlc: boolean;
};

export async function buildOperators(
  input: BuildOperatorsInput = {},
): Promise<BuildOperatorsResult> {
  const filters = {
    min_parcels: Math.max(1, Number(input.min_parcels ?? 2)),
    min_llcs: Math.max(1, Number(input.min_llcs ?? 1)),
    min_portfolio_value: Math.max(0, Number(input.min_portfolio_value ?? 0)),
    exclude_out_of_state: input.exclude_out_of_state !== false,
    exclude_municipal: input.exclude_municipal !== false,
    exclude_tax_departments: input.exclude_tax_departments !== false,
    home_states: (input.home_states ?? 'TX').trim() || 'TX',
    target_schema: (input.target_schema ?? 'permit_parcel').trim() || 'permit_parcel',
    target_table: (input.target_table ?? 'operators').trim() || 'operators',
  };

  if (filters.target_schema !== 'permit_parcel' || filters.target_table !== 'operators') {
    throw new Error(
      `Only permit_parcel.operators is supported today (got ${filters.target_schema}.${filters.target_table}).`,
    );
  }

  const homeStates = parseHomeStates(filters.home_states);
  const all = loadParcels();
  const byAddr = new Map<string, Agg>();
  const excluded = { no_mailing: 0, out_of_state: 0, municipal: 0, tax_department: 0 };

  for (const p of all) {
    const norm = normalizeMailingAddress(p.mailing_address);
    if (!norm) {
      excluded.no_mailing++;
      continue;
    }
    if (filters.exclude_tax_departments && isTaxDepartmentAddress(norm.key)) {
      excluded.tax_department++;
      continue;
    }
    if (
      filters.exclude_municipal &&
      (isMunicipalOwnerName(p.owner_name) || p.owner_type === 'municipal')
    ) {
      excluded.municipal++;
      continue;
    }
    if (filters.exclude_out_of_state) {
      const st = extractMailingState(norm.key);
      if (st && !homeStates.has(st)) {
        excluded.out_of_state++;
        continue;
      }
    }

    let agg = byAddr.get(norm.key);
    if (!agg) {
      agg = {
        display: norm.display,
        parcels: 0,
        llcs: new Set(),
        portfolioValue: 0,
        largestParcelValue: 0,
        counties: new Set(),
        topLlc: '',
        topLlcValue: 0,
        topParcelAddress: '',
        topParcelValue: 0,
        hasLocalLlc: false,
      };
      byAddr.set(norm.key, agg);
    }
    const val = p.assessed_value ?? 0;
    agg.parcels += 1;
    agg.portfolioValue += val;
    if (val > agg.largestParcelValue) agg.largestParcelValue = val;
    if (p.county) agg.counties.add(p.county);
    const owner = (p.owner_name ?? '').trim();
    if (owner) {
      agg.llcs.add(owner.toUpperCase());
      if (val >= agg.topLlcValue) {
        agg.topLlcValue = val;
        agg.topLlc = owner;
      }
    }
    if (p.owner_type === 'local_llc') agg.hasLocalLlc = true;
    const site = (p.parcel_address ?? '').trim();
    if (site && val >= agg.topParcelValue) {
      agg.topParcelValue = val;
      agg.topParcelAddress = site;
    }
  }

  const rows: Record<string, unknown>[] = [];
  let parcelsCovered = 0;
  let llcsCovered = 0;
  let portfolioTotal = 0;

  for (const [key, agg] of byAddr) {
    const distinctLlcs = agg.llcs.size;
    if (agg.parcels < filters.min_parcels) continue;
    if (distinctLlcs < filters.min_llcs) continue;
    if (agg.portfolioValue < filters.min_portfolio_value) continue;

    const countyList = [...agg.counties].sort();
    rows.push({
      operator_address: agg.display,
      parcels: agg.parcels,
      distinct_llcs: distinctLlcs,
      portfolio_value: Math.round(agg.portfolioValue),
      largest_parcel_value: Math.round(agg.largestParcelValue),
      counties: countyList.length,
      county_list: countyList.join(', '),
      top_llc: agg.topLlc || null,
      top_parcel_address: agg.topParcelAddress || null,
      has_local_llc: agg.hasLocalLlc,
      operator_name: null,
      domain: null,
      website: null,
      phone: null,
      place_id: null,
      confidence: null,
      resolved: false,
      resolved_at: null,
    });
    parcelsCovered += agg.parcels;
    llcsCovered += distinctLlcs;
    portfolioTotal += agg.portfolioValue;
  }

  rows.sort((a, b) => Number(b.portfolio_value) - Number(a.portfolio_value));

  if (!hasSupabase()) {
    throw new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_INGEST_SECRET).');
  }

  const { data, error } = await getSupabase().rpc('replace_permit_parcel_operators', {
    p_secret: ingestSecret(),
    p_rows: rows,
  });
  if (error) {
    throw new Error(`replace_permit_parcel_operators failed: ${error.message}`);
  }
  const operatorsBuilt =
    typeof data === 'number'
      ? data
      : Number((data as { operators_built?: number })?.operators_built ?? rows.length);

  const project = supabaseProjectRef();
  return {
    ok: true,
    operators_built: operatorsBuilt,
    parcels_covered: parcelsCovered,
    distinct_llcs_covered: llcsCovered,
    portfolio_value_total: portfolioTotal,
    filters,
    source_parcel_count: all.length,
    excluded,
    supabase_project: project,
    supabase_schema: filters.target_schema,
    verify_sql: [
      `select count(*) from ${filters.target_schema}.${filters.target_table};`,
      `select count(*) from ${filters.target_schema}.${filters.target_table} where distinct_llcs >= 3 and portfolio_value >= 5000000;`,
    ],
    assistant_instructions:
      'Operator rollup wrote counts only. Verify with verify_sql — do not select * into chat. Prefer these operators over per-LLC OpenSOS; do not buy bulk SOS lookups.',
  };
}
