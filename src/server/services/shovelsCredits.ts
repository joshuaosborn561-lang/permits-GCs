import type { ContractorQuery } from './shovelsContractors.js';
import { countMatchingShovelsContractors, loadShovelsContractors } from './shovelsContractors.js';

/**
 * Shovels paid plans: 1 credit = 1 record returned.
 * This repo's contractor tools read a local snapshot and spend 0 credits.
 */
export const SHOVELS_CREDIT_RULE =
  '1 Shovels API credit = 1 record returned on paid plans. The local cached file costs 0 credits.';

export interface ShovelsCreditEstimateInput extends ContractorQuery {
  /** Cap the live-API estimate (what a paid pull would bill). */
  max_records?: number;
}

export function estimateShovelsCredits(q: ShovelsCreditEstimateInput = {}) {
  const matching = countMatchingShovelsContractors(q);
  const loaded = loadShovelsContractors().length;
  const cap =
    q.max_records != null && Number.isFinite(q.max_records) && q.max_records > 0
      ? Math.floor(q.max_records)
      : matching;
  const liveCredits = Math.min(matching, cap);

  return {
    ok: true,
    source: 'cached_local_file',
    spends_shovels_credits: false,
    matching_records: matching,
    cached_file_size: loaded,
    max_records: q.max_records ?? null,
    filters: {
      q: q.q ?? null,
      place: q.place ?? null,
      city: q.city ?? null,
      state: q.state ?? null,
      has_email: q.has_email ?? null,
      has_phone: q.has_phone ?? null,
      has_website: q.has_website ?? null,
    },
    credits: {
      cached_query: 0,
      live_shovels_api: liveCredits,
      unit: '1 credit = 1 record returned',
    },
    rule: SHOVELS_CREDIT_RULE,
    explanation:
      matching === 0
        ? 'No cached contractors match these filters, so a live Shovels pull of the same filter would also return 0 records / 0 credits (unless Shovels has newer data).'
        : `Querying the local DFW snapshot is free (0 Shovels credits). A live Shovels API pull that returned these ${liveCredits} contractor record(s) would cost ${liveCredits} credit(s).`,
    assistant_instructions:
      'Show the user both numbers: cached query = 0 Shovels credits; live Shovels API = credits.live_shovels_api (1 per record). Do not claim the cached tools spend Shovels credits. If they only need this file, save_calling_list / sync_to_supabase next (still 0 Shovels credits).',
  };
}
