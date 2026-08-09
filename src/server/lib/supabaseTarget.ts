import { config } from '../config.js';
import { SCHEMA } from './supabase.js';

/** Project ref from SUPABASE_URL host (e.g. kemvxzhcxvynmoutwdrh). */
export function supabaseProjectRef(): string | null {
  const url = config.supabaseUrl;
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    return host.split('.')[0] || null;
  } catch {
    return null;
  }
}

export function supabaseTargetMeta() {
  return {
    supabase_project: supabaseProjectRef(),
    supabase_schema: SCHEMA,
    supabase_url: config.supabaseUrl || null,
  };
}
