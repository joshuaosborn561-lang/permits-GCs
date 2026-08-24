import { config } from '../config.js';
import { getSupabase, hasSupabase, ingestSecret } from './supabase.js';

const SETTING_KEY = 'shovels_api_key';

type KeySource = 'none' | 'env' | 'claude';

let runtimeKey = '';
let runtimeSource: KeySource = config.shovelsApiKey ? 'env' : 'none';
let updatedBy: string | null = null;
let updatedAt: string | null = null;
let loadedFromStore = false;

export function maskKey(key: string): string {
  const t = key.trim();
  if (!t) return '';
  if (t.length <= 8) return '••••';
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

export function getShovelsApiKey(): string {
  return (runtimeKey || config.shovelsApiKey || '').trim();
}

export function hasShovelsApi(): boolean {
  return Boolean(getShovelsApiKey());
}

export function shovelsKeyStatus() {
  const key = getShovelsApiKey();
  return {
    configured: Boolean(key),
    source: key ? runtimeSource : 'none',
    masked: key ? maskKey(key) : null,
    updated_by: updatedBy,
    updated_at: updatedAt,
    env_fallback: Boolean(config.shovelsApiKey),
    persist_available: hasSupabase(),
  };
}

export async function getShovelsKeyStatus() {
  await loadPersistedShovelsKey();
  return shovelsKeyStatus();
}

function applyRuntime(key: string, source: KeySource, by: string | null, at: string | null) {
  runtimeKey = key.trim();
  runtimeSource = runtimeKey ? source : 'none';
  updatedBy = by;
  updatedAt = at;
}

export async function loadPersistedShovelsKey(): Promise<void> {
  if (loadedFromStore) return;
  loadedFromStore = true;
  if (!hasSupabase()) {
    applyRuntime(config.shovelsApiKey, config.shovelsApiKey ? 'env' : 'none', null, null);
    return;
  }
  try {
    const { data, error } = await getSupabase().rpc('fetch_permit_parcel_setting', {
      p_secret: ingestSecret(),
      p_key: SETTING_KEY,
    });
    if (error) {
      console.warn('[shovels key] load failed', error.message);
      applyRuntime(config.shovelsApiKey, config.shovelsApiKey ? 'env' : 'none', null, null);
      return;
    }
    const row = data as {
      ok?: boolean;
      found?: boolean;
      value?: string;
      updated_by?: string;
      updated_at?: string;
    } | null;
    if (row?.found && row.value) {
      applyRuntime(String(row.value), 'claude', row.updated_by ?? null, row.updated_at ?? null);
      return;
    }
  } catch (err) {
    console.warn('[shovels key] load failed', err);
  }
  applyRuntime(config.shovelsApiKey, config.shovelsApiKey ? 'env' : 'none', null, null);
}

async function persistKey(key: string, by: string): Promise<string | null> {
  if (!hasSupabase()) return 'Supabase not configured — key is in memory only until restart';
  const { error } = await getSupabase().rpc('upsert_permit_parcel_setting', {
    p_secret: ingestSecret(),
    p_key: SETTING_KEY,
    p_value: key,
    p_updated_by: by,
  });
  return error ? error.message : null;
}

export async function setShovelsApiKey(opts: {
  api_key: string;
  set_by?: string;
  persist?: boolean;
}): Promise<Record<string, unknown>> {
  await loadPersistedShovelsKey();
  const key = opts.api_key.trim();
  const by = (opts.set_by || 'cayden').trim().toLowerCase() || 'cayden';
  if (key.length < 8) {
    return { ok: false, error: 'API key looks too short' };
  }
  applyRuntime(key, 'claude', by, new Date().toISOString());
  let persistError: string | null = null;
  if (opts.persist !== false) {
    persistError = await persistKey(key, by);
  }
  return {
    ok: true,
    ...shovelsKeyStatus(),
    persisted: opts.persist !== false && !persistError,
    persist_error: persistError,
    assistant_instructions:
      'Key is set. Never repeat the full key in chat. Show only the masked fingerprint, then call shovels_estimate_credits if they want a credit quote.',
  };
}

export async function clearShovelsApiKey(opts: { set_by?: string } = {}): Promise<Record<string, unknown>> {
  const by = (opts.set_by || 'cayden').trim().toLowerCase() || 'cayden';
  applyRuntime(config.shovelsApiKey, config.shovelsApiKey ? 'env' : 'none', by, new Date().toISOString());
  if (hasSupabase()) {
    await persistKey('', by);
  }
  return {
    ok: true,
    ...shovelsKeyStatus(),
    note: config.shovelsApiKey ? 'Reverted to SHOVELS_API_KEY env' : 'No key configured',
  };
}
