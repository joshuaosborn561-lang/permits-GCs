import { config, COST } from '../config.js';
import { runActor } from '../lib/apify.js';
import { structuredExtract } from '../lib/openai.js';
import type { PropertyRecord } from '../types.js';

const ACTOR_ID = 'memo23/loopnet-scraper-ppe';

export interface LoopnetResolveResult {
  property_manager_company: string | null;
  raw: unknown;
  cost: number;
  found: boolean;
  skipped?: boolean;
}

/**
 * Resolve PM companies for many properties according to LOOPNET_MODE:
 * - off: skip LoopNet entirely (fall through to Google)
 * - batched: few actor runs, many addresses each, no detail pages (cheap)
 * - per_property: legacy one-actor-per-address (EXPENSIVE — ~$0.10+/addr when unblocker hits)
 */
export async function resolveManyViaLoopnet(opts: {
  properties: PropertyRecord[];
  runId: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<Map<string, LoopnetResolveResult>> {
  const out = new Map<string, LoopnetResolveResult>();
  const props = opts.properties.filter((p) => p.address);

  if (config.loopnetMode === 'off') {
    for (const p of props) {
      out.set(p.id, {
        property_manager_company: null,
        raw: { skipped: true, reason: 'LOOPNET_MODE=off' },
        cost: 0,
        found: false,
        skipped: true,
      });
    }
    opts.onProgress?.(props.length, props.length);
    return out;
  }

  if (config.demoMode || !config.apifyToken) {
    for (const p of props) out.set(p.id, demoLoopnet(p));
    opts.onProgress?.(props.length, props.length);
    return out;
  }

  if (config.loopnetMode === 'per_property') {
    let done = 0;
    for (const p of props) {
      out.set(p.id, await resolveViaLoopnet({ property: p, runId: opts.runId }));
      done += 1;
      opts.onProgress?.(done, props.length);
    }
    return out;
  }

  // batched (default)
  const batchSize = Math.max(1, config.loopnetBatchSize);
  for (let i = 0; i < props.length; i += batchSize) {
    const batch = props.slice(i, i + batchSize);
    const batchResults = await resolveLoopnetBatch({
      properties: batch,
      runId: opts.runId,
    });
    for (const [id, result] of batchResults) out.set(id, result);
    opts.onProgress?.(Math.min(i + batch.length, props.length), props.length);
  }

  // Any property that somehow missed a result
  for (const p of props) {
    if (!out.has(p.id)) {
      out.set(p.id, {
        property_manager_company: null,
        raw: null,
        cost: 0,
        found: false,
      });
    }
  }
  return out;
}

/** Legacy single-address path (expensive). Prefer batched. */
export async function resolveViaLoopnet(opts: {
  property: PropertyRecord;
  runId: string;
}): Promise<LoopnetResolveResult> {
  const address = opts.property.address;
  if (!address) {
    return { property_manager_company: null, raw: null, cost: 0, found: false };
  }

  if (config.demoMode || !config.apifyToken) {
    return demoLoopnet(opts.property);
  }

  try {
    const items = await runActor<Record<string, unknown>>(
      ACTOR_ID,
      {
        addresses: [address],
        includeListingDetails: config.loopnetIncludeDetails,
        maxItems: 5,
        maxUnblockerRequests: config.loopnetMaxUnblockerRequests,
      },
      { label: 'loopnet' },
    );

    if (!items.length) {
      return {
        property_manager_company: null,
        raw: null,
        cost: estimateLoopnetActorCost(1, 0),
        found: false,
      };
    }

    const extracted = await extractPmFromLoopnetText({
      text: itemsToText(items),
      runId: opts.runId,
      propertyId: opts.property.id,
    });

    return {
      property_manager_company: extracted.property_manager_company,
      raw: items,
      cost: estimateLoopnetActorCost(1, items.length) + COST.openaiParsePerRecord,
      found: Boolean(extracted.property_manager_company),
    };
  } catch (err) {
    console.warn('[loopnet] failed for', address, err);
    return { property_manager_company: null, raw: { error: String(err) }, cost: 0, found: false };
  }
}

async function resolveLoopnetBatch(opts: {
  properties: PropertyRecord[];
  runId: string;
}): Promise<Map<string, LoopnetResolveResult>> {
  const out = new Map<string, LoopnetResolveResult>();
  const addresses = opts.properties.map((p) => p.address!).filter(Boolean);
  if (!addresses.length) return out;

  let items: Record<string, unknown>[] = [];
  let actorCost = 0;
  try {
    items = await runActor<Record<string, unknown>>(
      ACTOR_ID,
      {
        addresses,
        // Detail pages trigger ~$0.05 unblocker charges when App Check fails.
        // Batch mode keeps this OFF unless explicitly enabled.
        includeListingDetails: config.loopnetIncludeDetails,
        maxItems: Math.max(addresses.length * 3, 20),
        maxUnblockerRequests: config.loopnetMaxUnblockerRequests,
      },
      { label: `loopnet-batch-${addresses.length}` },
    );
    actorCost = estimateLoopnetActorCost(1, items.length);
  } catch (err) {
    console.warn('[loopnet] batch failed', err);
    for (const p of opts.properties) {
      out.set(p.id, {
        property_manager_company: null,
        raw: { error: String(err) },
        cost: 0,
        found: false,
      });
    }
    return out;
  }

  const costShare = actorCost / Math.max(opts.properties.length, 1);

  for (const prop of opts.properties) {
    const matched = items.filter((item) => addressMatches(prop.address!, item));
    if (!matched.length) {
      out.set(prop.id, {
        property_manager_company: null,
        raw: null,
        cost: costShare,
        found: false,
      });
      continue;
    }

    const extracted = await extractPmFromLoopnetText({
      text: itemsToText(matched),
      runId: opts.runId,
      propertyId: prop.id,
    });

    out.set(prop.id, {
      property_manager_company: extracted.property_manager_company,
      raw: matched,
      cost: costShare + (config.openaiApiKey ? COST.openaiParsePerRecord : 0),
      found: Boolean(extracted.property_manager_company),
    });
  }

  return out;
}

/** Rough Apify PPE estimate: actor start + result events (details OFF). */
function estimateLoopnetActorCost(actorStarts: number, resultCount: number): number {
  const start = actorStarts * COST.loopnetActorStart;
  const results = resultCount * COST.loopnetResultEvent;
  return start + results;
}

function itemsToText(items: Record<string, unknown>[]): string {
  return items
    .map((item) =>
      [
        item.description,
        item.listingDescription,
        item.companyName,
        item.brokerCompany,
        item.brokerName,
        item.propertyManager,
        item.managementCompany,
        item.address,
        item.streetAddress,
        JSON.stringify(item),
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n---\n');
}

function normalizeAddress(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\b(street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|suite|ste|unit)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function addressMatches(propertyAddress: string, item: Record<string, unknown>): boolean {
  const candidates = [
    item.address,
    item.streetAddress,
    item.fullAddress,
    item.propertyAddress,
    [item.street, item.city, item.state, item.zip].filter(Boolean).join(' '),
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(normalizeAddress);

  const target = normalizeAddress(propertyAddress);
  if (!target) return false;

  // Match on leading street number + first token of street name when possible
  const targetNum = target.match(/^(\d+)/)?.[1];
  for (const c of candidates) {
    if (!c) continue;
    if (c.includes(target) || target.includes(c)) return true;
    if (targetNum && c.startsWith(targetNum)) {
      const tRest = target.slice(targetNum.length).trim().split(' ')[0] ?? '';
      const cRest = c.slice(targetNum.length).trim().split(' ')[0] ?? '';
      if (tRest && cRest && (tRest === cRest || tRest.startsWith(cRest) || cRest.startsWith(tRest))) {
        return true;
      }
    }
  }
  return false;
}

async function extractPmFromLoopnetText(opts: {
  text: string;
  runId: string;
  propertyId: string;
}): Promise<{ property_manager_company: string | null }> {
  if (!config.openaiApiKey) {
    const m =
      opts.text.match(/managed by\s+([A-Z][\w& .,/-]{2,80})/i) ||
      opts.text.match(/property manager[:\s]+([A-Z][\w& .,/-]{2,80})/i);
    return { property_manager_company: m?.[1]?.trim() ?? null };
  }

  try {
    return await structuredExtract<{
      property_manager_company: string | null;
      leasing_broker_company: string | null;
      notes: string | null;
    }>({
      step: 'loopnet_pm_extract',
      runId: opts.runId,
      propertyId: opts.propertyId,
      schemaName: 'loopnet_pm_extract',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          property_manager_company: { type: ['string', 'null'] },
          leasing_broker_company: { type: ['string', 'null'] },
          notes: { type: ['string', 'null'] },
        },
        required: ['property_manager_company', 'leasing_broker_company', 'notes'],
      },
      system: `From LoopNet listing text, extract the property management company if mentioned, distinct from the leasing broker.
Only return a property_manager_company when the text clearly indicates management (e.g. "managed by", "property manager", "management company").
Do not treat the leasing broker as the property manager unless the text explicitly says they also manage the property.`,
      user: opts.text.slice(0, 12000),
    });
  } catch {
    return { property_manager_company: null };
  }
}

function demoLoopnet(property: PropertyRecord): LoopnetResolveResult {
  const hash = (property.address?.length ?? 0) + (property.owner_entity_name?.length ?? 0);
  if (hash % 2 === 0) {
    return {
      property_manager_company: 'Lone Star Asset Management',
      raw: { demo: true },
      cost: COST.loopnetPerRecord,
      found: true,
    };
  }
  return { property_manager_company: null, raw: null, cost: COST.loopnetPerRecord, found: false };
}
