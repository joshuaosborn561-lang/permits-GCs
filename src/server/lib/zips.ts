/**
 * US ZIP geography helpers.
 *
 * Precedence when resolving a market:
 *   1. explicit `zips` list (wins outright)
 *   2. `center` + `radius_miles` (haversine over data/us_zipcodes.csv)
 *   3. city / county / state (no ZIP expansion)
 */
import { createReadStream, existsSync } from 'fs';
import { createInterface } from 'readline';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { ParsedQueryParams } from '../types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEFAULT_ZIPS_PATH = join(ROOT, 'data', 'us_zipcodes.csv');

export interface ZipRow {
  zip: string;
  city: string;
  state: string;
  county: string;
  lat: number;
  lng: number;
  type: string;
}

export interface GeoResolution {
  mode: 'zips' | 'radius' | 'area';
  zips: string[];
  zip_count: number;
  zip_rows: ZipRow[];
  center: string | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_miles: number | null;
  states: string[];
}

const COORD_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;
const ZIP_RE = /^\d{5}$/;

let cache: ZipRow[] | null = null;

export function parseZipList(input: string | string[] | null | undefined): string[] {
  if (!input) return [];
  const parts = Array.isArray(input)
    ? input
    : String(input)
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const z = p.replace(/\D/g, '').slice(0, 5);
    if (!ZIP_RE.test(z) || seen.has(z)) continue;
    seen.add(z);
    out.push(z);
    if (out.length >= 5000) break;
  }
  return out;
}

export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export async function loadAllZips(path = DEFAULT_ZIPS_PATH): Promise<ZipRow[]> {
  if (cache) return cache;
  if (!existsSync(path)) {
    throw new Error(
      `${path} not found. Commit data/us_zipcodes.csv or generate it before planning radius/ZIP pulls.`,
    );
  }
  const rows: ZipRow[] = [];
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  let headerSkipped = false;
  for await (const line of rl) {
    if (!headerSkipped) {
      headerSkipped = true;
      continue;
    }
    if (!line.trim()) continue;
    const [zip, city, state, county, lat, lng, type] = line.split(',');
    if (!ZIP_RE.test(zip)) continue;
    const latN = Number(lat);
    const lngN = Number(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) continue;
    rows.push({
      zip,
      city: city ?? '',
      state: (state ?? '').toUpperCase(),
      county: county ?? '',
      lat: latN,
      lng: lngN,
      type: type ?? '',
    });
  }
  cache = rows;
  return rows;
}

/** Test helper / warm cache. */
export function clearZipCache(): void {
  cache = null;
}

export function resolveCenterCoords(
  center: string,
  all: ZipRow[],
): { lat: number; lng: number; label: string } {
  const coord = center.match(COORD_RE);
  if (coord) {
    return {
      lat: Number(coord[1]),
      lng: Number(coord[2]),
      label: `${coord[1]},${coord[2]}`,
    };
  }

  const cleaned = center.replace(/\./g, '').trim();
  // "Dallas Fort Worth, TX" / "Dallas, TX" / "Dallas TX" / "DFW, TX"
  const stateMatch =
    cleaned.match(/,\s*([A-Za-z]{2})\s*$/) || cleaned.match(/\s+([A-Za-z]{2})\s*$/);
  const state = stateMatch?.[1]?.toUpperCase() ?? null;
  let place = (stateMatch ? cleaned.slice(0, stateMatch.index) : cleaned).trim();
  // Drop trailing full state names: "Dallas Texas"
  place = place.replace(/\s+(Texas|California|Georgia|Florida|Ohio|Michigan)$/i, '').trim();

  const aliases: Record<string, string> = {
    dfw: 'Dallas',
    'dallas fort worth': 'Dallas',
    'dallas-fort worth': 'Dallas',
    'dallas/fort worth': 'Dallas',
    'fort worth dallas': 'Dallas',
  };
  place = aliases[place.toLowerCase()] ?? place;

  const placeLower = place.toLowerCase();
  const matches = all.filter((r) => {
    if (state && r.state !== state) return false;
    return r.city.toLowerCase() === placeLower;
  });

  if (!matches.length) {
    // Fallback: city contains token
    const fuzzy = all.filter((r) => {
      if (state && r.state !== state) return false;
      return r.city.toLowerCase().includes(placeLower.split(/\s+/)[0]!);
    });
    if (!fuzzy.length) {
      throw new Error(`Could not resolve center "${center}" against ZIP centroids`);
    }
    const lat = average(fuzzy.map((r) => r.lat));
    const lng = average(fuzzy.map((r) => r.lng));
    return { lat, lng, label: center };
  }

  // Prefer a well-known Dallas reference when the brief says Dallas/DFW, TX
  if (/^dallas$/i.test(place) && (!state || state === 'TX')) {
    return { lat: 32.7767, lng: -97.0, label: center };
  }

  return {
    lat: average(matches.map((r) => r.lat)),
    lng: average(matches.map((r) => r.lng)),
    label: center,
  };
}

function average(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export async function zipsWithinRadius(
  centerLat: number,
  centerLng: number,
  radiusMiles: number,
  opts?: { states?: string[]; path?: string },
): Promise<ZipRow[]> {
  const all = await loadAllZips(opts?.path);
  const keep = opts?.states?.length
    ? new Set(opts.states.map((s) => s.toUpperCase()))
    : null;
  return all.filter((r) => {
    if (keep && !keep.has(r.state)) return false;
    return haversineMiles(centerLat, centerLng, r.lat, r.lng) <= radiusMiles;
  });
}

export async function rowsForZips(
  zips: string[],
  path = DEFAULT_ZIPS_PATH,
): Promise<ZipRow[]> {
  const wanted = new Set(zips);
  const all = await loadAllZips(path);
  const found = all.filter((r) => wanted.has(r.zip));
  // Preserve caller order; include unknown ZIPs as stubs so count still matches
  const byZip = new Map(found.map((r) => [r.zip, r]));
  return zips.map(
    (z) =>
      byZip.get(z) ?? {
        zip: z,
        city: '',
        state: '',
        county: '',
        lat: 0,
        lng: 0,
        type: 'UNKNOWN',
      },
  );
}

/**
 * Apply geography precedence and return the resolved ZIP set + center.
 * Mutates nothing; caller should merge into ParsedQueryParams.
 */
export async function resolveGeography(
  params: ParsedQueryParams,
): Promise<GeoResolution> {
  const explicit = parseZipList(params.zips?.length ? params.zips : params.zips_csv);
  if (explicit.length) {
    const zip_rows = await rowsForZips(explicit);
    const states = unique(zip_rows.map((r) => r.state).filter(Boolean));
    const withCoords = zip_rows.filter((r) => r.lat || r.lng);
    return {
      mode: 'zips',
      zips: explicit,
      zip_count: explicit.length,
      zip_rows,
      center: params.center ?? null,
      center_lat: withCoords.length ? average(withCoords.map((r) => r.lat)) : null,
      center_lng: withCoords.length ? average(withCoords.map((r) => r.lng)) : null,
      radius_miles: params.radius_miles ?? null,
      states,
    };
  }

  const center = (params.center || '').trim();
  const radius = params.radius_miles;
  if (center && radius && radius > 0) {
    const all = await loadAllZips();
    const resolved = resolveCenterCoords(center, all);
    // If the brief/location already pinned a state (e.g. "Dallas TX"), keep ZIPs in that state.
    const stateHint = extractState(params.location_value) || extractState(center);
    const zip_rows = await zipsWithinRadius(resolved.lat, resolved.lng, radius, {
      states: stateHint ? [stateHint] : undefined,
    });
    const states = unique(zip_rows.map((r) => r.state));
    return {
      mode: 'radius',
      zips: zip_rows.map((r) => r.zip),
      zip_count: zip_rows.length,
      zip_rows,
      center: resolved.label,
      center_lat: resolved.lat,
      center_lng: resolved.lng,
      radius_miles: radius,
      states: stateHint ? [stateHint] : states,
    };
  }

  if (params.location_type === 'radius' && params.location_value && radius && radius > 0) {
    const all = await loadAllZips();
    const resolved = resolveCenterCoords(params.location_value, all);
    const stateHint = extractState(params.location_value);
    const zip_rows = await zipsWithinRadius(resolved.lat, resolved.lng, radius, {
      states: stateHint ? [stateHint] : undefined,
    });
    return {
      mode: 'radius',
      zips: zip_rows.map((r) => r.zip),
      zip_count: zip_rows.length,
      zip_rows,
      center: params.location_value,
      center_lat: resolved.lat,
      center_lng: resolved.lng,
      radius_miles: radius,
      states: stateHint ? [stateHint] : unique(zip_rows.map((r) => r.state)),
    };
  }

  return {
    mode: 'area',
    zips: [],
    zip_count: 0,
    zip_rows: [],
    center: params.center ?? null,
    center_lat: null,
    center_lng: null,
    radius_miles: params.radius_miles ?? null,
    states: extractState(params.location_value)
      ? [extractState(params.location_value)!]
      : [],
  };
}

export function applyGeoToParams(
  params: ParsedQueryParams,
  geo: GeoResolution,
): ParsedQueryParams {
  const next: ParsedQueryParams = {
    ...params,
    zips: geo.zips,
    zip_count: geo.zip_count,
    center: geo.center,
    center_lat: geo.center_lat,
    center_lng: geo.center_lng,
    radius_miles: geo.radius_miles,
    states: geo.states,
  };
  if (geo.mode === 'radius' || (geo.mode === 'zips' && geo.radius_miles)) {
    next.location_type = 'radius';
    if (geo.center) next.location_value = geo.center;
  } else if (geo.mode === 'zips') {
    next.location_type = 'zips';
    next.location_value =
      geo.zips.length <= 6
        ? geo.zips.join(', ')
        : `${geo.zips.length} ZIP codes (${geo.zips.slice(0, 3).join(', ')}…)`;
  }
  return next;
}

export function parseExcludeCategories(
  input: string | string[] | null | undefined,
): string[] {
  if (!input) return [];
  const parts = Array.isArray(input) ? input : String(input).split(',');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const c = p.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

export function matchesExcludedCategory(
  haystack: string,
  exclude: string[],
): boolean {
  if (!exclude.length) return false;
  const h = haystack.toLowerCase();
  return exclude.some((ex) => h.includes(ex));
}

function extractState(value?: string | null): string | null {
  if (!value) return null;
  const m = value.match(/\b([A-Z]{2})\b/);
  return m?.[1] ?? null;
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const s = v.toUpperCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
