import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CountyCode, OwnerType, ParcelRecord } from '../types.js';
import { classifyOwnerType } from './ownerType.js';

export interface ParcelQuery {
  county?: CountyCode | string;
  owner_name?: string;
  city?: string;
  zip?: string;
  use_code?: string;
  owner_type?: OwnerType | string;
  min_assessed_value?: number;
  q?: string;
  page?: number;
  page_size?: number;
}

export interface ParcelQueryResult {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  items: ParcelRecord[];
}

let cache: ParcelRecord[] | null = null;
let loadError: string | null = null;

function dataRoot(): string {
  return join(process.cwd(), 'data', 'parcels');
}

/** Minimal CSV parse (quotes + commas). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function emptyToNull(v: string | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t ? t : null;
}

function toNum(v: string | null): number | null {
  if (!v) return null;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function countyFromFolder(folder: string): CountyCode | null {
  const f = folder.toLowerCase();
  if (f === 'dcad' || f === 'dallas') return 'Dallas';
  if (f === 'tad' || f === 'tarrant') return 'Tarrant';
  if (f === 'ccad' || f === 'collin') return 'Collin';
  return null;
}

function parcelId(county: CountyCode, accountId: string): string {
  return createHash('sha1').update(`${county}:${accountId}`).digest('hex').slice(0, 32);
}

function loadFile(county: CountyCode, path: string): ParcelRecord[] {
  const text = readFileSync(path, 'utf8');
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iAccount = idx('account_id');
  const iOwner = idx('owner_name');
  const iMail = idx('mailing_address');
  const iParcel = idx('parcel_address');
  const iCity = idx('city');
  const iZip = idx('zip');
  const iValue = idx('assessed_value');
  const iUse = idx('use_code');
  const iProp = idx('prop_type');
  const iOwnerType = idx('owner_type');

  const out: ParcelRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r]!;
    const account = emptyToNull(cols[iAccount]);
    const owner = emptyToNull(cols[iOwner]);
    if (!account && !owner) continue;
    const accountId = account || `row-${r}`;
    const ownerName = owner || '';
    const ownerType =
      (emptyToNull(cols[iOwnerType]) as OwnerType | null) || classifyOwnerType(ownerName);
    out.push({
      id: parcelId(county, accountId),
      county,
      account_id: accountId,
      owner_name: ownerName,
      mailing_address: emptyToNull(cols[iMail]),
      parcel_address: emptyToNull(cols[iParcel]),
      city: emptyToNull(cols[iCity]),
      zip: emptyToNull(cols[iZip])?.slice(0, 5) ?? null,
      assessed_value: toNum(emptyToNull(cols[iValue])),
      use_code: emptyToNull(cols[iUse]),
      prop_type: emptyToNull(cols[iProp]) || 'commercial',
      owner_type: ownerType,
    });
  }
  return out;
}

export function loadParcels(): ParcelRecord[] {
  if (cache) return cache;
  const root = dataRoot();
  if (!existsSync(root)) {
    loadError = `Missing parcels data dir: ${root}`;
    cache = [];
    return cache;
  }
  const all: ParcelRecord[] = [];
  for (const folder of readdirSync(root)) {
    const county = countyFromFolder(folder);
    if (!county) continue;
    const csvPath = join(root, folder, 'commercial_parcels.csv');
    if (!existsSync(csvPath)) continue;
    try {
      const rows = loadFile(county, csvPath);
      console.log(`[parcels] loaded ${rows.length} from ${folder}`);
      all.push(...rows);
    } catch (err) {
      console.warn(`[parcels] failed ${csvPath}`, err);
      loadError = err instanceof Error ? err.message : String(err);
    }
  }
  cache = all;
  return cache;
}

function matches(p: ParcelRecord, q: ParcelQuery): boolean {
  if (q.county && p.county.toLowerCase() !== String(q.county).toLowerCase()) return false;
  if (q.owner_type && p.owner_type !== q.owner_type) return false;
  if (q.zip && (p.zip || '').slice(0, 5) !== String(q.zip).slice(0, 5)) return false;
  if (q.city && !(p.city || '').toLowerCase().includes(String(q.city).toLowerCase())) return false;
  if (q.use_code && !(p.use_code || '').toLowerCase().includes(String(q.use_code).toLowerCase())) {
    return false;
  }
  if (q.owner_name && !p.owner_name.toLowerCase().includes(String(q.owner_name).toLowerCase())) {
    return false;
  }
  if (q.min_assessed_value != null) {
    if (p.assessed_value == null || p.assessed_value < q.min_assessed_value) return false;
  }
  if (q.q) {
    const needle = String(q.q).toLowerCase();
    const hay = [
      p.owner_name,
      p.mailing_address,
      p.parcel_address,
      p.city,
      p.zip,
      p.use_code,
      p.account_id,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

function filterAll(q: ParcelQuery): ParcelRecord[] {
  return loadParcels().filter((p) => matches(p, q));
}

export function queryParcels(q: ParcelQuery): ParcelQueryResult {
  const all = filterAll(q);
  const pageSize = Math.min(Math.max(q.page_size ?? 25, 1), 50);
  const page = Math.max(q.page ?? 1, 1);
  const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
  const start = (page - 1) * pageSize;
  return {
    total: all.length,
    page,
    page_size: pageSize,
    total_pages: totalPages,
    items: all.slice(start, start + pageSize),
  };
}

export function sampleParcels(n = 20, q: ParcelQuery = {}) {
  const all = filterAll(q);
  const size = Math.min(Math.max(n, 1), 20);
  const copy = [...all];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return { n: size, total_matching: all.length, items: copy.slice(0, size) };
}

export function parcelsSummary(): Record<string, unknown> {
  const all = loadParcels();
  const byCounty: Record<string, number> = {};
  const byOwnerType: Record<string, number> = {};
  let withValue = 0;
  let valueSum = 0;
  for (const p of all) {
    byCounty[p.county] = (byCounty[p.county] || 0) + 1;
    byOwnerType[p.owner_type] = (byOwnerType[p.owner_type] || 0) + 1;
    if (p.assessed_value != null) {
      withValue += 1;
      valueSum += p.assessed_value;
    }
  }
  return {
    loaded: all.length > 0,
    load_error: loadError,
    total_parcels: all.length,
    counties: byCounty,
    owner_type: byOwnerType,
    with_assessed_value: withValue,
    assessed_value_sum: Math.round(valueSum),
    sources: {
      Dallas: 'DCAD commercial extract',
      Tarrant: 'TAD PropertyData commercial',
      Collin: 'CCAD Socrata commercial',
    },
    query_hint:
      'Use parcels_query (max 50/page). Full matching sets sync to Supabase via sync_to_supabase — do not dump rows into chat.',
  };
}

export function parcelsToCsv(rows: ParcelRecord[]): string {
  const headers: (keyof ParcelRecord)[] = [
    'county',
    'account_id',
    'owner_name',
    'owner_type',
    'mailing_address',
    'parcel_address',
    'city',
    'zip',
    'assessed_value',
    'use_code',
    'prop_type',
  ];
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join(
    '\n',
  );
}

/** All matching rows for server-side sync (not for MCP chat dumps). */
export function collectParcelsForSync(q: ParcelQuery, cap = 50000): ParcelRecord[] {
  return filterAll(q).slice(0, cap);
}
