import { COST, config } from '../config.js';
import type { CostEstimate, ParsedQueryParams } from '../types.js';

export function estimateCost(params: ParsedQueryParams): CostEstimate {
  const n = params.max_records;
  const fallout = config.loopnetFalloutPct;

  const step1 = n * COST.propwirePerRecord;
  const step2 = n * COST.openaiParsePerRecord;
  // Assume ~50% lack c/o and go to LoopNet (configurable)
  const loopnetRecords = Math.round(n * fallout);
  const step3 = loopnetRecords * COST.loopnetPerRecord;
  // Of LoopNet fallout, assume another 50% need Google, capped
  const googleQueries = Math.min(config.googleSearchHardCap, Math.round(loopnetRecords * 0.5));
  const step4 = googleQueries * COST.googleSearchPerQuery;

  const total = step1 + step2 + step3 + step4;
  // Contact enrichment: getleads $0; AI Ark / LeadMagic / Google only on cache miss fallout
  // Present as a band: low = mostly getleads hits, high = more paid fallthrough
  const contactLow = 0;
  const contactHigh = Math.round(n * 0.15) * (COST.aiArkPerLookup + COST.leadmagicPerLookup * 0.3);

  const geoNotes: string[] = [];
  if (params.zips_explicit && params.zips?.length) {
    geoNotes.push(
      `Explicit ZIP list: ${params.zips.length} ZIPs (Propwire searches each ZIP; results filtered to this list)`,
    );
  } else if (params.center && params.radius_miles) {
    geoNotes.push(
      `Radius search: ${params.radius_miles} mi around ${params.center}` +
        (params.zip_count
          ? ` → ${params.zip_count} ZIPs in footprint (single Propwire radius pull, not per-ZIP)`
          : ''),
    );
  }
  if (params.states?.length) {
    geoNotes.push(`States: ${params.states.join(', ')}`);
  }
  if (params.exclude_categories?.length) {
    geoNotes.push(`Excluding categories: ${params.exclude_categories.join(', ')}`);
  }

  return {
    step1_propwire: round6(step1),
    step2_openai: round6(step2),
    step3_loopnet: round6(step3),
    step4_google: round6(step4),
    step5_contacts_note:
      'getleads is $0 (unlimited plan). AI Ark (~$0.0015/lookup) and LeadMagic (~$0.05/role match) only run on cache misses when getleads returns nothing.',
    total_low: round6(total + contactLow),
    total_high: round6(total + contactHigh),
    assumptions: [
      ...geoNotes,
      `LoopNet fallout assumption: ${(fallout * 100).toFixed(0)}% of records (LOOPNET_FALLOUT_PCT)`,
      `Google search capped at ${config.googleSearchHardCap} queries`,
      `Propwire full detail: $${COST.propwirePerRecord}/record`,
      `OpenAI nano parse: ~$${COST.openaiParsePerRecord}/record`,
      `LoopNet: $${COST.loopnetPerRecord}/record`,
      `Google search: $${COST.googleSearchPerQuery}/query`,
    ],
    disclaimer:
      'Apify platform minimum fees and OpenAI API costs are billed separately by those platforms. This is an estimate, not an invoice.',
  };
}

export function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function addCost(
  breakdown: Record<string, number>,
  key: string,
  amount: number,
): { breakdown: Record<string, number>; delta: number } {
  const next = { ...breakdown, [key]: round6((breakdown[key] ?? 0) + amount) };
  return { breakdown: next, delta: amount };
}
