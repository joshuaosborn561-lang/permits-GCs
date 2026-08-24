import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { hasShovelsApi, probeContractorCount, resolveShovelsGeo, getShovelsUsage } from '../lib/shovels.js';
import type { ContractorQuery } from './shovelsContractors.js';
import { countMatchingShovelsContractors, loadShovelsContractors } from './shovelsContractors.js';

/** How the last in-repo DFW commercial pull actually billed. */
export const LAST_DFW_JOB = {
  date_from: '2025-08-01',
  date_to: '2026-08-07',
  filter: 'property_type=commercial',
  page_size: 100,
  requests_used: 67,
  unique_contractors: 6124,
  pages: {
    Dallas: 43,
    Fort_Worth: 22,
    Rockwall_County: 1,
  },
  fetched: {
    Dallas: 4279,
    Fort_Worth: 2192,
    Rockwall_County: 29,
  },
} as const;

const GEO_ALIASES: Record<string, { kind: 'city' | 'county'; q: string; place: string }> = {
  dallas: { kind: 'city', q: 'Dallas', place: 'Dallas' },
  dallas_city: { kind: 'city', q: 'Dallas', place: 'Dallas' },
  dallas_county: { kind: 'county', q: 'Dallas', place: 'Dallas' },
  fort_worth: { kind: 'county', q: 'Tarrant', place: 'Fort_Worth' },
  fortworth: { kind: 'county', q: 'Tarrant', place: 'Fort_Worth' },
  tarrant: { kind: 'county', q: 'Tarrant', place: 'Fort_Worth' },
  tarrant_county: { kind: 'county', q: 'Tarrant', place: 'Fort_Worth' },
  houston: { kind: 'city', q: 'Houston', place: 'Houston' },
  harris: { kind: 'county', q: 'Harris', place: 'Harris' },
  harris_county: { kind: 'county', q: 'Harris', place: 'Harris' },
};

export interface ShovelsCreditEstimateInput extends ContractorQuery {
  max_records?: number;
  date_from?: string;
  date_to?: string;
  property_type?: string;
  page_size?: number;
  /** County/city aliases: Dallas, Tarrant, Fort_Worth, Rockwall, or comma list. */
  geos?: string;
}

function loadLastJobMeta(): Record<string, unknown> {
  const p = join(process.cwd(), 'data', 'shovels_commercial_contractors', 'summary.json');
  if (!existsSync(p)) return LAST_DFW_JOB;
  try {
    return { ...LAST_DFW_JOB, ...(JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>) };
  } catch {
    return LAST_DFW_JOB;
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultWindow() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  return { date_from: isoDate(from), date_to: isoDate(to) };
}

function pagesFor(count: number, pageSize: number): number {
  if (count <= 0) return 0;
  return Math.ceil(count / pageSize);
}

function resolveTargets(input: ShovelsCreditEstimateInput): Array<{ kind: 'city' | 'county'; q: string; place: string }> {
  const raw = [input.geos, input.place, input.city]
    .filter(Boolean)
    .join(',')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!raw.length) {
    return [
      GEO_ALIASES.dallas,
      GEO_ALIASES.tarrant,
    ];
  }
  const out: Array<{ kind: 'city' | 'county'; q: string; place: string }> = [];
  const seen = new Set<string>();
  for (const token of raw) {
    const key = token.toLowerCase().replace(/\s+/g, '_');
    const alias = GEO_ALIASES[key];
    if (alias) {
      if (seen.has(alias.place)) continue;
      seen.add(alias.place);
      out.push(alias);
      continue;
    }
    const place = token.replace(/\s+/g, '_');
    if (seen.has(place)) continue;
    seen.add(place);
    out.push({
      kind: /county/i.test(token) ? 'county' : 'city',
      q: token.replace(/_/g, ' ').replace(/ county$/i, ''),
      place,
    });
  }
  return out;
}

function historicalPages(place: string): { pages: number; fetched: number } | null {
  if (place === 'Dallas') return { pages: LAST_DFW_JOB.pages.Dallas, fetched: LAST_DFW_JOB.fetched.Dallas };
  if (place === 'Fort_Worth') return { pages: LAST_DFW_JOB.pages.Fort_Worth, fetched: LAST_DFW_JOB.fetched.Fort_Worth };
  if (place === 'Rockwall_County') {
    return { pages: LAST_DFW_JOB.pages.Rockwall_County, fetched: LAST_DFW_JOB.fetched.Rockwall_County };
  }
  return null;
}

/**
 * Accurate live estimate: 1 cheap include_count probe per geo, then
 * credits ≈ pages at size=100. Matches the last DFW job (67 requests /
 * 6,124 contractors — Dallas+Tarrant well under 500).
 */
export async function estimateShovelsCredits(q: ShovelsCreditEstimateInput = {}) {
  const pageSize = Math.min(100, Math.max(1, q.page_size ?? 100));
  const window = {
    date_from: q.date_from || defaultWindow().date_from,
    date_to: q.date_to || defaultWindow().date_to,
  };
  const propertyType = q.property_type || 'commercial';
  const targets = resolveTargets(q);
  const cachedMatching = countMatchingShovelsContractors(q);
  const lastJob = loadLastJobMeta();

  const geos = [];
  let probeCredits = 0;
  let live = false;
  let liveError: string | null = null;
  let usage: Record<string, unknown> | null = null;

  if (hasShovelsApi()) {
    live = true;
    try {
      usage = await getShovelsUsage();
      for (const t of targets) {
        const geo = await resolveShovelsGeo({ kind: t.kind, q: t.q });
        const probe = await probeContractorCount({
          geo,
          permit_from: window.date_from,
          permit_to: window.date_to,
          property_type: propertyType,
        });
        const hist = historicalPages(t.place);
        const pages = pagesFor(probe.total_count, pageSize);
        probeCredits += probe.headers.credits_request ?? 1;
        geos.push({
          place: t.place,
          requested: t,
          geo,
          total_count: probe.total_count,
          count_relation: probe.count_relation,
          estimated_pages: pages,
          estimated_credits: pages,
          probe_credits: probe.headers.credits_request,
          last_job_pages: hist?.pages ?? null,
          last_job_fetched: hist?.fetched ?? null,
        });
      }
    } catch (err) {
      live = false;
      liveError = err instanceof Error ? err.message : String(err);
    }
  }

  if (!geos.length) {
    for (const t of targets) {
      const hist = historicalPages(t.place);
      const fetched = hist?.fetched ?? 0;
      const pages = hist?.pages ?? pagesFor(fetched, pageSize);
      geos.push({
        place: t.place,
        requested: t,
        geo: null,
        total_count: fetched,
        count_relation: hist ? 'last_job' : null,
        estimated_pages: pages,
        estimated_credits: pages,
        probe_credits: 0,
        last_job_pages: hist?.pages ?? null,
        last_job_fetched: hist?.fetched ?? null,
      });
    }
  }

  const contractors = geos.reduce((n, g) => n + Number(g.total_count || 0), 0);
  let pages = geos.reduce((n, g) => n + Number(g.estimated_credits || 0), 0);
  let companies = contractors;
  if (q.max_records && q.max_records > 0) {
    pages = Math.min(pages, pagesFor(q.max_records, pageSize));
    companies = Math.min(companies, q.max_records);
  }

  return {
    ok: true,
    source: live ? 'shovels_api_include_count' : liveError ? 'last_job_fallback' : 'last_job_no_api_key',
    live_api: live,
    shovels_api_configured: hasShovelsApi(),
    key_hint: hasShovelsApi()
      ? null
      : 'No Shovels key on this server. Cayden can set one with shovels_set_api_key (confirm=true). Never echo the full key.',
    live_error: liveError,
    spends_shovels_credits: live,
    probe_credits_spent: live ? probeCredits : 0,
    window: { ...window, property_type: propertyType, page_size: pageSize },
    geos,
    contractors,
    billing: {
      free_trial:
        'Historically 1 credit = 1 API request/page, regardless of how many companies are on the page. Free Online now also advertises 500 record-credits/mo and 10 results per query — confirm which meter your key is on.',
      paid: '1 credit = 1 company/record returned. A size=100 page costs ~100 credits.',
    },
    credits: {
      cached_query: 0,
      free_tier_pages: pages,
      paid_tier_companies: companies,
      estimate: pages,
      unit_free: '1 credit ≈ 1 API page (how the last DFW pull billed — under 500)',
      unit_paid: '1 credit = 1 contractor record',
    },
    last_dfw_job: {
      requests_used: lastJob.requests_used_this_job ?? LAST_DFW_JOB.requests_used,
      unique_contractors: lastJob.unique_contractors ?? LAST_DFW_JOB.unique_contractors,
      pages: LAST_DFW_JOB.pages,
      note: 'Dallas + Tarrant was 65 pages / 6,471 rows. Under 500 only matches request/page billing (free/trial). Paid would have been ~6,471 company-credits.',
    },
    usage,
    cached_file_size: loadShovelsContractors().length,
    cached_matching: cachedMatching,
    filters: {
      q: q.q ?? null,
      place: q.place ?? null,
      geos: q.geos ?? null,
      city: q.city ?? null,
      state: q.state ?? null,
    },
    explanation: `Dallas+Tarrant-style pull: ~${pages} pages / ~${companies} companies. Free/trial (page meter): ~${pages} credits. Paid (company meter): ~${companies} credits. Last DFW job used 67 requests for 6,124 unique contractors and stayed under 500 — that is the free/page meter, not paid.`,
    assistant_instructions: hasShovelsApi()
      ? 'Always show BOTH numbers: credits.free_tier_pages vs credits.paid_tier_companies. Ask which plan the key is on. Last Dallas+Tarrant under 500 = free/page billing. If they are on paid now, quote paid_tier_companies. Cached list tools still cost 0.'
      : 'No API key is configured, so this is the last-job fallback. Offer shovels_set_api_key so Cayden can paste a key. Never echo the full key. Still show both free_tier_pages and paid_tier_companies.',
  };
}
