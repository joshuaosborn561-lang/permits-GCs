import { config } from '../config.js';
import { getShovelsApiKey, hasShovelsApi as hasRuntimeShovelsKey } from './shovelsKey.js';

const BASE = config.shovelsBaseUrl || 'https://api.shovels.ai/v2';

const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
]);

export interface ShovelsHeaders {
  credits_request: number | null;
  credits_limit: number | null;
  credits_remaining: number | null;
}

export interface ShovelsGeo {
  geo_id: string;
  name: string;
  state?: string;
  kind: 'city' | 'county' | 'state';
}

export interface ContractorCountProbe {
  geo: ShovelsGeo;
  total_count: number;
  count_relation: string | null;
  items_on_probe: number;
  headers: ShovelsHeaders;
}

export interface ShovelsApiContractor {
  id: string;
  name: string | null;
  business_name: string | null;
  dba: string | null;
  phone: string | null;
  primary_phone: string | null;
  email: string | null;
  primary_email: string | null;
  website: string | null;
  linkedin_url: string | null;
  employee_count: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  places: string[];
  permit_count: number | null;
  total_job_value: number | null;
  primary_industry: string | null;
  business_type: string | null;
}

function headerNum(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function creditHeaders(res: Response): ShovelsHeaders {
  return {
    credits_request: headerNum(res, 'x-credits-request'),
    credits_limit: headerNum(res, 'x-credits-limit'),
    credits_remaining: headerNum(res, 'x-credits-remaining'),
  };
}

export function hasShovelsApi(): boolean {
  return hasRuntimeShovelsKey();
}

async function shovelsGet(path: string, query: Record<string, string | number | boolean | undefined>) {
  const apiKey = getShovelsApiKey();
  if (!apiKey) {
    throw new Error('SHOVELS_API_KEY is not configured — Cayden can set it with shovels_set_api_key');
  }
  const url = new URL(path.startsWith('http') ? path : `${BASE}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v == null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-API-Key': apiKey,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const detail =
      typeof body === 'object' && body && 'detail' in body
        ? JSON.stringify((body as { detail: unknown }).detail).slice(0, 240)
        : text.slice(0, 240);
    throw new Error(`Shovels ${res.status} ${path}: ${detail}`);
  }
  return { body, headers: creditHeaders(res), status: res.status };
}

export async function getShovelsUsage(): Promise<Record<string, unknown> | null> {
  if (!hasShovelsApi()) return null;
  const { body, headers } = await shovelsGet('/usage', {});
  return { ...(body as Record<string, unknown>), headers };
}

/** Prefer requested state when given; never force TX. Nationwide OK. */
export function pickGeo(
  items: Array<{ geo_id?: string; name?: string; state?: string }>,
  kind: 'city' | 'county',
  needle: string,
  state?: string,
): ShovelsGeo | null {
  if (!items.length) return null;
  const want = needle.toLowerCase().trim();
  const wantState = state?.trim().toUpperCase() || null;

  let pool = items;
  if (wantState) {
    const filtered = items.filter(
      (i) =>
        (i.state || '').toUpperCase() === wantState ||
        new RegExp(`,\\s*${wantState}\\b`, 'i').test(i.name || ''),
    );
    if (filtered.length) pool = filtered;
  }

  const nameOf = (i: { name?: string }) => (i.name || '').toLowerCase();
  const exact =
    pool.find((i) => nameOf(i) === want) ||
    pool.find((i) => nameOf(i).startsWith(`${want},`)) ||
    pool.find((i) => nameOf(i).includes(want));
  const hit = exact || pool[0];
  if (!hit?.geo_id) return null;
  return {
    geo_id: hit.geo_id,
    name: hit.name || needle,
    state: hit.state || wantState || undefined,
    kind,
  };
}

export async function resolveShovelsGeo(opts: {
  kind: 'city' | 'county' | 'state';
  q: string;
  /** Optional 2-letter state to disambiguate city/county names nationwide. */
  state?: string;
}): Promise<ShovelsGeo> {
  const q = opts.q.trim();
  if (!q) throw new Error('Empty Shovels geo query');

  const asState = q.toUpperCase();
  if (opts.kind === 'state' || (q.length === 2 && US_STATES.has(asState))) {
    if (!US_STATES.has(asState)) throw new Error(`Unknown US state code "${q}"`);
    return { geo_id: asState, name: asState, state: asState, kind: 'state' };
  }

  const path = opts.kind === 'city' ? '/cities/search' : '/counties/search';
  const { body } = await shovelsGet(path, { q });
  const items = Array.isArray((body as { items?: unknown[] })?.items)
    ? ((body as { items: Array<{ geo_id?: string; name?: string; state?: string }> }).items)
    : [];
  const geo = pickGeo(items, opts.kind === 'county' ? 'county' : 'city', q, opts.state);
  if (!geo) throw new Error(`No Shovels ${opts.kind} geo for "${q}"${opts.state ? ` (${opts.state})` : ''}`);
  return geo;
}

export async function probeContractorCount(opts: {
  geo: ShovelsGeo;
  permit_from: string;
  permit_to: string;
  property_type?: string;
}): Promise<ContractorCountProbe> {
  const { body, headers } = await shovelsGet('/contractors/search', {
    geo_id: opts.geo.geo_id,
    permit_from: opts.permit_from,
    permit_to: opts.permit_to,
    property_type: opts.property_type || 'commercial',
    include_count: true,
    include_tallies: false,
    size: 1,
  });
  const rec = body as {
    total_count?: number;
    count?: number;
    count_relation?: string;
    items?: unknown[];
  };
  const total =
    Number(rec.total_count ?? rec.count ?? 0) ||
    (Array.isArray(rec.items) ? rec.items.length : 0);
  return {
    geo: opts.geo,
    total_count: total,
    count_relation: rec.count_relation ?? (rec.total_count != null ? 'eq' : null),
    items_on_probe: Array.isArray(rec.items) ? rec.items.length : 0,
    headers,
  };
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function mapShovelsApiContractor(raw: Record<string, unknown>, placeTag: string): ShovelsApiContractor {
  const addr =
    raw.address && typeof raw.address === 'object'
      ? (raw.address as Record<string, unknown>)
      : {};
  const street = [strOrNull(addr.street_no), strOrNull(addr.street)].filter(Boolean).join(' ') || null;
  return {
    id: String(raw.id ?? ''),
    name: strOrNull(raw.name),
    business_name: strOrNull(raw.business_name),
    dba: strOrNull(raw.dba),
    phone: strOrNull(raw.phone),
    primary_phone: strOrNull(raw.primary_phone),
    email: strOrNull(raw.email),
    primary_email: strOrNull(raw.primary_email),
    website: strOrNull(raw.website),
    linkedin_url: strOrNull(raw.linkedin_url),
    employee_count: strOrNull(raw.employee_count),
    address_street: street,
    address_city: strOrNull(addr.city),
    address_state: strOrNull(addr.state),
    address_zip: strOrNull(addr.zip_code) || strOrNull(addr.zip),
    places: [placeTag],
    permit_count: numOrNull(raw.permit_count),
    total_job_value: numOrNull(raw.total_job_value),
    primary_industry: strOrNull(raw.primary_industry),
    business_type: strOrNull(raw.business_type),
  };
}

export async function pullContractorsForGeo(opts: {
  geo: ShovelsGeo;
  place: string;
  permit_from: string;
  permit_to: string;
  property_type?: string;
  page_size?: number;
  max_records?: number;
  /** Stop after this many pages even if more remain. */
  max_pages?: number;
}): Promise<{
  items: ShovelsApiContractor[];
  pages: number;
  credits_spent: number;
  truncated: boolean;
  next_cursor: string | null;
  headers_last: ShovelsHeaders | null;
}> {
  const pageSize = Math.min(100, Math.max(1, opts.page_size ?? 100));
  const maxRecords = Math.max(1, opts.max_records ?? 2000);
  const maxPages = Math.max(1, opts.max_pages ?? 100);
  const items: ShovelsApiContractor[] = [];
  let cursor: string | null = null;
  let pages = 0;
  let credits = 0;
  let headersLast: ShovelsHeaders | null = null;
  let truncated = false;

  while (items.length < maxRecords && pages < maxPages) {
    const query: Record<string, string | number | boolean | undefined> = {
      geo_id: opts.geo.geo_id,
      permit_from: opts.permit_from,
      permit_to: opts.permit_to,
      property_type: opts.property_type || 'commercial',
      include_count: pages === 0,
      include_tallies: false,
      size: Math.min(pageSize, maxRecords - items.length),
    };
    if (cursor) query.cursor = cursor;

    const { body, headers } = await shovelsGet('/contractors/search', query);
    headersLast = headers;
    credits += headers.credits_request ?? 0;
    pages += 1;

    const rec = body as { items?: unknown[]; next_cursor?: string | null };
    const batch = Array.isArray(rec.items) ? rec.items : [];
    for (const raw of batch) {
      if (!raw || typeof raw !== 'object') continue;
      const mapped = mapShovelsApiContractor(raw as Record<string, unknown>, opts.place);
      if (!mapped.id) continue;
      items.push(mapped);
      if (items.length >= maxRecords) break;
    }

    cursor = rec.next_cursor ?? null;
    if (!cursor || !batch.length) break;
    if (items.length >= maxRecords) {
      truncated = true;
      break;
    }
  }

  if (cursor && items.length >= maxRecords) truncated = true;

  return {
    items,
    pages,
    credits_spent: credits,
    truncated,
    next_cursor: cursor,
    headers_last: headersLast,
  };
}
