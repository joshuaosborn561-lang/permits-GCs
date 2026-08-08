import dotenv from 'dotenv';

dotenv.config();

function env(key: string, fallback = ''): string {
  return process.env[key]?.trim() || fallback;
}

function envBool(key: string, fallback = false): boolean {
  const v = process.env[key];
  if (v == null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export const config = {
  port: Number(env('PORT', '8080')),
  demoMode: envBool('DEMO_MODE', false),
  supabaseUrl: env('SUPABASE_URL'),
  supabaseAnonKey: env('SUPABASE_ANON_KEY'),
  supabaseIngestSecret: env('SUPABASE_INGEST_SECRET'),
  supabaseServiceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  openSosApiKey: env('OPENSOSDATA_API_KEY'),
  openSosBaseUrl: env('OPENSOSDATA_BASE_URL', 'https://api.opensosdata.com'),
};

export type AppConfig = typeof config;
