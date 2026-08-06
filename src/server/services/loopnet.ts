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
}

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
        includeListingDetails: true,
        maxItems: 5,
      },
      { label: 'loopnet' },
    );

    if (!items.length) {
      return { property_manager_company: null, raw: null, cost: COST.loopnetPerRecord, found: false };
    }

    const textBlob = items
      .map((item) =>
        [
          item.description,
          item.listingDescription,
          item.companyName,
          item.brokerCompany,
          item.brokerName,
          JSON.stringify(item),
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n---\n');

    const extracted = await extractPmFromLoopnetText({
      text: textBlob,
      runId: opts.runId,
      propertyId: opts.property.id,
    });

    return {
      property_manager_company: extracted.property_manager_company,
      raw: items,
      cost: COST.loopnetPerRecord + COST.openaiParsePerRecord,
      found: Boolean(extracted.property_manager_company),
    };
  } catch (err) {
    console.warn('[loopnet] failed for', address, err);
    return { property_manager_company: null, raw: { error: String(err) }, cost: 0, found: false };
  }
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
  // Resolve roughly half of non-c/o demo records
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
