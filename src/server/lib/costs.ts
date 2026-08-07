import { COST, config } from '../config.js';
import type { CostEstimate, ParsedQueryParams } from '../types.js';

export function estimateCost(params: ParsedQueryParams): CostEstimate {
  const n = params.max_records;
  const fallout = config.loopnetFalloutPct;

  const step1 = n * COST.propwirePerRecord;
  const step2 = n * COST.openaiParsePerRecord;
  // Assume ~50% lack c/o and go to LoopNet (configurable)
  const loopnetRecords = Math.round(n * fallout);
  const step3 = estimateLoopnetStepCost(loopnetRecords);
  // Of LoopNet fallout, assume another 50% need Google, capped
  // When LoopNet is off, more records fall through to Google.
  const googleShare = config.loopnetMode === 'off' ? 1 : 0.5;
  const googleQueries = Math.min(
    config.googleSearchHardCap,
    Math.round(loopnetRecords * googleShare),
  );
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
      `LoopNet mode: ${config.loopnetMode}` +
        (config.loopnetMode === 'batched'
          ? ` (batch size ${config.loopnetBatchSize}, details=${config.loopnetIncludeDetails})`
          : ''),
      `LoopNet fallout assumption: ${(fallout * 100).toFixed(0)}% of records (LOOPNET_FALLOUT_PCT)`,
      loopnetModeAssumption(),
      `Google search capped at ${config.googleSearchHardCap} queries`,
      `Propwire full detail: $${COST.propwirePerRecord}/record`,
      `OpenAI nano parse: ~$${COST.openaiParsePerRecord}/record`,
      `Google search: $${COST.googleSearchPerQuery}/query`,
    ],
    disclaimer:
      'Apify platform minimum fees and OpenAI API costs are billed separately by those platforms. This is an estimate, not an invoice.',
  };
}

function estimateLoopnetStepCost(loopnetRecords: number): number {
  if (loopnetRecords <= 0) return 0;
  if (config.loopnetMode === 'off') return 0;
  if (config.loopnetMode === 'per_property') {
    // Real-world observed ~$0.10–0.13/addr when detail unblocker fires.
    // Estimate uses start + ~2 results; warn via assumptions.
    return (
      loopnetRecords *
      (COST.loopnetActorStart + 2 * COST.loopnetResultEvent)
    );
  }
  // batched: one actor start per batch + ~1.5 result events per address
  const batches = Math.ceil(loopnetRecords / Math.max(1, config.loopnetBatchSize));
  return (
    batches * COST.loopnetActorStart +
    loopnetRecords * 1.5 * COST.loopnetResultEvent
  );
}

function loopnetModeAssumption(): string {
  if (config.loopnetMode === 'off') {
    return 'LoopNet DISABLED (LOOPNET_MODE=off) — unresolved c/o rows go straight to Google';
  }
  if (config.loopnetMode === 'per_property') {
    return (
      'LoopNet per_property mode is EXPENSIVE (~$0.10+/address when App Check fails and detail unblocker bills $0.05/page). Prefer LOOPNET_MODE=batched or off.'
    );
  }
  return (
    `LoopNet batched: ~$${COST.loopnetActorStart}/batch start + $${COST.loopnetResultEvent}/result; ` +
    `details ${config.loopnetIncludeDetails ? 'ON (can add $0.05/page)' : 'OFF (recommended)'}`
  );
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
