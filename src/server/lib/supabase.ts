import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const SCHEMA = 'property_pm_finder';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: SupabaseClient<any, any, any> | null = null;

export function hasSupabase(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

export function getSupabase(): SupabaseClient<any, any, any> {
  if (!hasSupabase()) {
    throw new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  }
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: SCHEMA },
    });
  }
  return client;
}

export { SCHEMA };
