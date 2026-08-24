import { config } from '../config.js';
import { getShovelsApiKey, hasShovelsApi as hasRuntimeShovelsKey } from './shovelsKey.js';

const BASE = config.shovelsBaseUrl || 'https://api.shovels.ai/v2';

export interface ShovelsHeaders {
  credits_request: number | null;
  credits_limit: number | null;
  credits_remaining: number | null;
}

export interface ShovelsGeo {
  geo_id: string;
  name: string;
  state?: string;
  kind: 'city' | 'county';
}

export interface ContractorCountProbe {
  geo: ShovelsGeo;
  total_count: number;
  count_relation: string | null;
  items_on_probe: number;
  headers: ShovelsHeaders;
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

function pickTxGeo(
  items: Array<{ geo_id?: string; name?: string; state?: string }>,
  kind: 'city' | 'county',
  needle: string,
): ShovelsGeo | null {
  const want = needle.toLowerCase();
  const tx = items.filter((i) => (i.state || '').toUpperCase() === 'TX' || /,\s*TX\b/i.test(i.name || ''));
  const pool = tx.length ? tx : items;
  const hit =
    pool.find((i) => (i.name || '').toLowerCase().includes(want)) ||
    pool[0];
  if (!hit?.geo_id) return null;
  return { geo_id: hit.geo_id, name: hit.name || needle, state: hit.state, kind };
}

export async function resolveShovelsGeo(opts: {
  kind: 'city' | 'county';
  q: string;
}): Promise<ShovelsGeo> {
  const path = opts.kind === 'city' ? '/cities/search' : '/counties/search';
  const { body } = await shovelsGet(path, { q: opts.q });
  const items = Array.isArray((body as { items?: unknown[] })?.items)
    ? ((body as { items: Array<{ geo_id?: string; name?: string; state?: string }> }).items)
    : [];
  const geo = pickTxGeo(items, opts.kind, opts.q);
  if (!geo) throw new Error(`No Shovels ${opts.kind} geo for "${opts.q}"`);
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
