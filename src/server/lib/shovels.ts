import { config } from '../config.js';
import { getShovelsApiKey, hasShovelsApi as hasRuntimeShovelsKey } from './shovelsKey.js';

const BASE = config.shovelsBaseUrl || 'https://api.shovels.ai/v2';

const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
]);

export type GeoKind = 'city' | 'county' | 'state' | 'zip';

export interface ShovelsHeaders {
  credits_request: number | null;
  credits_limit: number | null;
  credits_remaining: number | null;
  /** Raw header dump for debugging when credit fields are missing. */
  raw?: Record<string, string>;
}

export interface ShovelsGeo {
  geo_id: string;
  name: string;
  state?: string;
  kind: GeoKind;
}

export interface ContractorCountProbe {
  geo: ShovelsGeo;
  total_count: number;
  count_relation: string | null;
  items_on_probe: number;
  headers: ShovelsHeaders;
  /** True when Shovels returned no usable count (possible thin/no coverage). */
  no_coverage: boolean;
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

export class GeoResolutionError extends Error {
  requested: Record<string, unknown>;
  resolved: Record<string, unknown> | null;

  constructor(message: string, requested: Record<string, unknown>, resolved: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'GeoResolutionError';
    this.requested = requested;
    this.resolved = resolved;
  }
}

function headerNum(res: Response, ...names: string[]): number | null {
  for (const name of names) {
    const raw = res.headers.get(name);
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function creditHeaders(res: Response): ShovelsHeaders {
  const raw: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    if (/credit/i.test(k) || /x-/i.test(k)) raw[k] = v;
  });
  return {
    credits_request: headerNum(res, 'x-credits-request', 'x-credit-request', 'credits-request'),
    credits_limit: headerNum(res, 'x-credits-limit', 'x-credit-limit', 'credits-limit'),
    credits_remaining: headerNum(res, 'x-credits-remaining', 'x-credit-remaining', 'credits-remaining'),
    raw: Object.keys(raw).length ? raw : undefined,
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
  const rec = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const used = Number(rec.credits_used ?? rec.used ?? NaN);
  const limit = Number(rec.credit_limit ?? rec.credits_limit ?? headers.credits_limit ?? NaN);
  const remaining =
    headers.credits_remaining != null
      ? headers.credits_remaining
      : Number.isFinite(used) && Number.isFinite(limit)
        ? Math.max(0, limit - used)
        : null;
  return {
    ...rec,
    credits_used: Number.isFinite(used) ? used : null,
    credits_remaining: remaining,
    credits_limit: Number.isFinite(limit) ? limit : headers.credits_limit,
    headers,
  };
}

/** Shovels returns total_count as `{ value, relation }` — not a bare number. */
export function parseTotalCount(raw: unknown): { value: number; relation: string | null } {
  if (raw == null) return { value: 0, relation: null };
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { value: raw, relation: 'eq' };
  }
  if (typeof raw === 'object') {
    const obj = raw as { value?: unknown; relation?: unknown; count?: unknown };
    if (obj.value != null) {
      const v = Number(obj.value);
      return {
        value: Number.isFinite(v) ? v : 0,
        relation: obj.relation != null ? String(obj.relation) : 'eq',
      };
    }
    if (obj.count != null) {
      const v = Number(obj.count);
      return { value: Number.isFinite(v) ? v : 0, relation: 'eq' };
    }
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    return { value: Number(raw), relation: 'eq' };
  }
  return { value: 0, relation: null };
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** True when resolved name is a legitimate match for the requested needle+kind. */
export function geoNameMatches(
  resolvedName: string,
  kind: GeoKind,
  needle: string,
  state?: string,
): boolean {
  const name = norm(resolvedName);
  const want = norm(needle);
  if (!want) return false;
  const st = state?.trim().toUpperCase();

  if (kind === 'zip') {
    const digits = want.replace(/\D/g, '').slice(0, 5);
    return resolvedName.replace(/\D/g, '').startsWith(digits) || name.includes(digits);
  }
  if (kind === 'state') {
    return name === want || name.startsWith(`${want},`) || name === want.toLowerCase();
  }
  if (kind === 'county') {
    // Accept "Denton County, TX" or "Denton County"
    const countyForm = `${want} county`;
    if (!(name === countyForm || name.startsWith(`${countyForm},`) || name.startsWith(`${countyForm} `))) {
      // Also allow exact "Denton, TX" only if the API labels it as county in the name
      if (!(/\bcounty\b/.test(name) && (name.startsWith(`${want},`) || name.startsWith(`${want} `)))) {
        return false;
      }
    }
    if (st && !name.includes(`, ${st.toLowerCase()}`) && !name.endsWith(` ${st.toLowerCase()}`)) {
      // state field may still match even if name omits it
      return true; // state checked separately via item.state
    }
    return true;
  }
  // city: first segment must equal the needle (rejects "Anna, Collin, TX" for needle "Collin")
  const first = name.split(',')[0]?.trim() || '';
  if (first === want) return true;
  if (first.startsWith(`${want} `)) return true; // "San Antonio"
  return false;
}

/**
 * Pick a geo from search hits. Never returns a mismatched city for a county
 * request (e.g. Hunt → Hunt, Kerr, TX when asking for Hunt County).
 */
export function pickGeo(
  items: Array<{ geo_id?: string; name?: string; state?: string }>,
  kind: 'city' | 'county' | 'zip',
  needle: string,
  state?: string,
): ShovelsGeo | null {
  if (!items.length) return null;
  const want = norm(needle);
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

  const nameOf = (i: { name?: string }) => norm(i.name || '');

  let hit: (typeof items)[number] | undefined;
  if (kind === 'county') {
    hit =
      pool.find((i) => nameOf(i) === `${want} county`) ||
      pool.find((i) => nameOf(i) === `${want} county, ${wantState?.toLowerCase() || ''}`) ||
      pool.find((i) => nameOf(i).startsWith(`${want} county,`)) ||
      pool.find((i) => nameOf(i).startsWith(`${want} county`)) ||
      pool.find((i) => /\bcounty\b/.test(nameOf(i)) && geoNameMatches(i.name || '', 'county', needle, state));
  } else if (kind === 'zip') {
    const digits = needle.replace(/\D/g, '').slice(0, 5);
    hit =
      pool.find((i) => i.geo_id === digits || i.geo_id === needle) ||
      pool.find((i) => (i.name || '').replace(/\D/g, '').startsWith(digits));
  } else {
    hit =
      pool.find((i) => nameOf(i) === want) ||
      (wantState
        ? pool.find((i) => nameOf(i) === `${want}, ${wantState.toLowerCase()}`)
        : undefined) ||
      pool.find((i) => nameOf(i).startsWith(`${want},`)) ||
      pool.find((i) => geoNameMatches(i.name || '', 'city', needle, state));
  }

  if (!hit?.geo_id) return null;
  if (!geoNameMatches(hit.name || '', kind, needle, state ?? hit.state)) {
    return null;
  }
  return {
    geo_id: hit.geo_id,
    name: hit.name || needle,
    state: hit.state || wantState || undefined,
    kind,
  };
}

export async function resolveShovelsGeo(opts: {
  kind: GeoKind;
  q: string;
  /** Optional 2-letter state to disambiguate city/county names nationwide. */
  state?: string;
}): Promise<ShovelsGeo> {
  const q = opts.q.trim();
  if (!q) throw new GeoResolutionError('Empty Shovels geo query', { ...opts });

  const asState = q.toUpperCase();
  if (opts.kind === 'state' || (opts.kind !== 'zip' && q.length === 2 && US_STATES.has(asState))) {
    if (!US_STATES.has(asState)) {
      throw new GeoResolutionError(`Unknown US state code "${q}"`, { ...opts });
    }
    return { geo_id: asState, name: asState, state: asState, kind: 'state' };
  }

  // ZIPs are valid geo_ids directly (docs); skip search to avoid burning credits.
  if (opts.kind === 'zip' || /^\d{5}(-\d{4})?$/.test(q)) {
    const zip = q.replace(/\D/g, '').slice(0, 5);
    if (!/^\d{5}$/.test(zip)) {
      throw new GeoResolutionError(`Invalid ZIP "${q}"`, { ...opts });
    }
    return { geo_id: zip, name: zip, state: opts.state, kind: 'zip' };
  }

  const path =
    opts.kind === 'county' ? '/counties/search' : opts.kind === 'city' ? '/cities/search' : '/cities/search';

  let body: unknown;
  try {
    ({ body } = await shovelsGet(path, { q }));
  } catch (err) {
    throw new GeoResolutionError(
      err instanceof Error ? err.message : String(err),
      { kind: opts.kind, q, state: opts.state },
    );
  }

  const items = Array.isArray((body as { items?: unknown[] })?.items)
    ? ((body as { items: Array<{ geo_id?: string; name?: string; state?: string }> }).items)
    : [];

  const pickKind = opts.kind === 'county' ? 'county' : 'city';
  const geo = pickGeo(items, pickKind, q, opts.state);

  if (!geo) {
    const top = items.slice(0, 3).map((i) => i.name).filter(Boolean);
    throw new GeoResolutionError(
      `No Shovels ${opts.kind} match for "${q}"${opts.state ? ` (${opts.state})` : ''}` +
        (top.length ? ` — top hits were: ${top.join(' | ')}` : ' — empty search result') +
        `. Refusing to probe. Pass an explicit level (e.g. "${q} County, ${opts.state || 'TX'}" or geo_level=county).`,
      { kind: opts.kind, q, state: opts.state },
      top.length ? { top_hits: top } : null,
    );
  }

  if (!geoNameMatches(geo.name, geo.kind, q, opts.state ?? geo.state)) {
    throw new GeoResolutionError(
      `Requested ${opts.kind} "${q}" resolved to "${geo.name}" (${geo.geo_id}) — mismatch, refusing to probe`,
      { kind: opts.kind, q, state: opts.state },
      { resolved_geo_id: geo.geo_id, resolved_name: geo.name, resolved_kind: geo.kind, resolved_state: geo.state },
    );
  }

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
    total_count?: unknown;
    count?: unknown;
    count_relation?: string;
    items?: unknown[];
  };
  const parsed = parseTotalCount(rec.total_count ?? rec.count);
  // Never fall back to items.length — size=1 would report "1 contractor" for every geo.
  const total = parsed.value;
  const relation =
    parsed.relation ??
    (typeof rec.count_relation === 'string' ? rec.count_relation : null);
  return {
    geo: opts.geo,
    total_count: total,
    count_relation: relation,
    items_on_probe: Array.isArray(rec.items) ? rec.items.length : 0,
    headers,
    no_coverage: total === 0,
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
