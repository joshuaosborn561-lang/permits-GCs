import { getSetting, loadAppSettings } from './appSettings.js';

export const VERIPHONE_USD_PER_LOOKUP = 0.0024;

export function hasVeriphone(): boolean {
  return Boolean(getSetting('veriphone_api_key'));
}

export interface VeriphoneLookup {
  phone: string;
  e164: string | null;
  valid: boolean;
  phone_type: string;
  normalized_type: 'mobile' | 'landline' | 'voip' | 'toll_free' | 'unknown';
  carrier: string | null;
  country: string | null;
  raw_status: string | null;
}

function normalizeType(raw: string): VeriphoneLookup['normalized_type'] {
  const t = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (t.includes('mobile') || t.includes('wireless') || t === 'cell') return 'mobile';
  if (t.includes('voip')) return 'voip';
  if (t.includes('toll')) return 'toll_free';
  if (t.includes('land') || t.includes('fixed') || t.includes('wireline')) return 'landline';
  return 'unknown';
}

export async function lookupVeriphone(phone: string): Promise<VeriphoneLookup> {
  await loadAppSettings();
  const key = getSetting('veriphone_api_key');
  if (!key) throw new Error('VERIPHONE_API_KEY is not set — Cayden can paste it with set_enrichment_api_key');
  const digits = phone.replace(/\D/g, '');
  const url = new URL('https://api.veriphone.io/v2/verify');
  url.searchParams.set('key', key);
  url.searchParams.set('phone', digits.length === 10 ? `+1${digits}` : phone);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = (await res.json().catch(() => null)) as {
    status?: string;
    phone?: string;
    phone_valid?: boolean;
    phone_type?: string;
    carrier?: string;
    country?: string;
    error?: string;
  } | null;
  if (!res.ok) {
    throw new Error(`Veriphone ${res.status}: ${body?.error || res.statusText}`);
  }
  const rawType = String(body?.phone_type || '');
  return {
    phone,
    e164: body?.phone ?? null,
    valid: Boolean(body?.phone_valid),
    phone_type: rawType || 'unknown',
    normalized_type: normalizeType(rawType),
    carrier: body?.carrier ?? null,
    country: body?.country ?? null,
    raw_status: body?.status ?? null,
  };
}

export function estimateVeriphoneUsd(n: number): { lookups: number; usd: number; note: string } {
  return {
    lookups: n,
    usd: Math.round(n * VERIPHONE_USD_PER_LOOKUP * 100) / 100,
    note: 'Veriphone Standard list price ~$2.40 per 1,000. Confirm before running lookup_line_type.',
  };
}
