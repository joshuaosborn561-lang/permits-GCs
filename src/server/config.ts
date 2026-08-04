import 'dotenv/config';

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback = false): boolean {
  const raw = process.env[name]?.toLowerCase();
  if (raw == null || raw === '') return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export const config = {
  port: num('PORT', 8080),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  demoMode: bool('DEMO_MODE', false),

  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1-nano',

  apifyToken: process.env.APIFY_TOKEN ?? '',

  // Borrowed from google-maps-scraper Railway service
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
  supabaseIngestSecret: process.env.SUPABASE_INGEST_SECRET ?? '',
  /** Optional override; Maps scraper does not use this. */
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',

  getleadsApiKey: process.env.GETLEADS_API_KEY ?? '',
  getleadsBaseUrl: process.env.GETLEADS_BASE_URL ?? 'https://api.getleads.io',
  aiArkApiKey: process.env.AI_ARK_API_KEY ?? '',
  aiArkBaseUrl: process.env.AI_ARK_BASE_URL ?? 'https://api.ai-ark.com',
  leadmagicApiKey: process.env.LEADMAGIC_API_KEY ?? '',

  loopnetFalloutPct: num('LOOPNET_FALLOUT_PCT', 0.5),
  googleSearchHardCap: num('GOOGLE_SEARCH_HARD_CAP', 5000),
  propwireBatchSize: num('PROPWIRE_BATCH_SIZE', 50),
  maxConcurrentApify: num('MAX_CONCURRENT_APIFY', 3),
};

/** Per-unit cost estimates used for pre-run and live tracking (USD). */
export const COST = {
  propwirePerRecord: 0.00155,
  openaiParsePerRecord: 0.001,
  loopnetPerRecord: 0.0015,
  googleSearchPerQuery: 0.0025,
  /** getleads unlimited plan — $0 marginal */
  getleadsPerLookup: 0,
  /** AI Ark people search ~0.5 credits ≈ $0.0015 at volume ($3/1k credits) */
  aiArkPerLookup: 0.0015,
  /**
   * LeadMagic role-finder = 2 credits; Essential plan ≈ $0.0198/credit → ~$0.04
   * using Growth-ish midpoint of ~$0.025/credit → $0.05 for role + email path.
   */
  leadmagicPerLookup: 0.05,
  googleContactSearchPerQuery: 0.0025,
} as const;

export const TARGET_TITLES = [
  'Property Manager',
  'Facilities Manager',
  'Regional Manager',
  'VP Operations',
  'Director of Property Management',
  'Portfolio Manager',
] as const;

export const LARGE_PM_FIRMS = [
  'cbre',
  'jll',
  'jones lang lasalle',
  'cushman & wakefield',
  'cushman and wakefield',
  'greystar',
  'colliers',
  'newmark',
  'lincoln property',
  'brookfield',
  'prologis',
  'hines',
  'related',
  'equity residential',
  'avalonbay',
] as const;

export function isLargePmFirm(name: string): boolean {
  const key = name.toLowerCase().trim();
  return LARGE_PM_FIRMS.some((f) => key.includes(f));
}
