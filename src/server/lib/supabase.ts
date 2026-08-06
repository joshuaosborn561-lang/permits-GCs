import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const SCHEMA = 'property_pm_finder';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: SupabaseClient<any, any, any> | null = null;

/** Same credential trio as the Google Maps scraper Railway service. */
export function hasSupabase(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey && config.supabaseIngestSecret);
}

export function getSupabase(): SupabaseClient<any, any, any> {
  if (!hasSupabase()) {
    throw new Error(
      'Supabase is not configured (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_INGEST_SECRET)',
    );
  }
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export function ingestSecret(): string {
  return config.supabaseIngestSecret;
}

export { SCHEMA };
