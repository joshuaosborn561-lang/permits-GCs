import { config, COST } from '../config.js';
import { runActor } from '../lib/apify.js';
import { structuredExtract } from '../lib/openai.js';
import type { PropertyRecord } from '../types.js';

const ACTOR_ID = 'apify/google-search-scraper';

export interface GooglePmResult {
  property_manager_company: string | null;
  raw: unknown;
  cost: number;
  found: boolean;
}

export async function resolveViaGoogle(opts: {
  property: PropertyRecord;
  runId: string;
}): Promise<GooglePmResult> {
  const query = buildPmQuery(opts.property);
  if (!query) {
    return { property_manager_company: null, raw: null, cost: 0, found: false };
  }

  if (config.demoMode || !config.apifyToken) {
    return demoGoogle(opts.property);
  }

  try {
    const items = await runActor<Record<string, unknown>>(
      ACTOR_ID,
      {
        queries: query,
        maxPagesPerQuery: 1,
        countryCode: 'us',
        languageCode: 'en',
      },
      { label: 'google-search-pm' },
    );

    const text = serializeSerp(items);
    const extracted = await extractPmFromSerp({
      text,
      query,
      runId: opts.runId,
      propertyId: opts.property.id,
    });

    return {
      property_manager_company: extracted.property_manager_company,
      raw: items,
      cost: COST.googleSearchPerQuery + COST.openaiParsePerRecord,
      found: Boolean(extracted.property_manager_company),
    };
  } catch (err) {
    console.warn('[google-pm] failed', query, err);
    return { property_manager_company: null, raw: { error: String(err) }, cost: 0, found: false };
  }
}

export async function searchContactsViaGoogle(opts: {
  company: string;
  runId: string;
}): Promise<{
  contact_name: string | null;
  contact_title: string | null;
  raw: unknown;
  cost: number;
}> {
  const query = `"${opts.company}" ("property manager" OR "regional manager" OR "director of property management") site:linkedin.com`;

  if (config.demoMode || !config.apifyToken) {
    return {
      contact_name: null,
      contact_title: null,
      raw: null,
      cost: COST.googleContactSearchPerQuery,
    };
  }

  try {
    const items = await runActor<Record<string, unknown>>(
      ACTOR_ID,
      {
        queries: query,
        maxPagesPerQuery: 1,
        countryCode: 'us',
        languageCode: 'en',
      },
      { label: 'google-search-contact' },
    );

    const text = serializeSerp(items);
    if (!config.openaiApiKey) {
      return { contact_name: null, contact_title: null, raw: items, cost: COST.googleContactSearchPerQuery };
    }

    const extracted = await structuredExtract<{
      contact_name: string | null;
      contact_title: string | null;
    }>({
      step: 'google_contact_extract',
      runId: opts.runId,
      schemaName: 'google_contact_extract',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          contact_name: { type: ['string', 'null'] },
          contact_title: { type: ['string', 'null'] },
        },
        required: ['contact_name', 'contact_title'],
      },
      system:
        'Extract a likely property management decision maker name and title from LinkedIn-oriented search results. Only return values when clearly present. This is a soft signal, not a confirmed contact.',
      user: text.slice(0, 12000),
    });

    return {
      ...extracted,
      raw: items,
      cost: COST.googleContactSearchPerQuery + COST.openaiParsePerRecord,
    };
  } catch (err) {
    console.warn('[google-contact] failed', opts.company, err);
    return {
      contact_name: null,
      contact_title: null,
      raw: { error: String(err) },
      cost: 0,
    };
  }
}

function buildPmQuery(property: PropertyRecord): string | null {
  if (property.building_name) {
    return `"${property.building_name}" property management`;
  }
  if (property.address) {
    const street = property.address.split(',')[0]?.trim();
    if (street) return `"${street}" property management`;
  }
  return null;
}

function serializeSerp(items: Record<string, unknown>[]): string {
  return items
    .map((item) => {
      const organic = (item.organicResults || item.results || []) as Array<Record<string, unknown>>;
      if (Array.isArray(organic) && organic.length) {
        return organic
          .slice(0, 10)
          .map((r) => `${r.title ?? ''}\n${r.description ?? r.snippet ?? ''}\n${r.url ?? r.link ?? ''}`)
          .join('\n\n');
      }
      return JSON.stringify(item).slice(0, 4000);
    })
    .join('\n---\n');
}

async function extractPmFromSerp(opts: {
  text: string;
  query: string;
  runId: string;
  propertyId: string;
}): Promise<{ property_manager_company: string | null }> {
  if (!config.openaiApiKey) {
    const m = opts.text.match(/([A-Z][\w& .,-]{2,60})\s+(Property Management|Management Company|Realty)/);
    return { property_manager_company: m ? `${m[1]} ${m[2]}`.trim() : null };
  }

  try {
    return await structuredExtract<{ property_manager_company: string | null; confidence_note: string | null }>({
      step: 'google_pm_extract',
      runId: opts.runId,
      propertyId: opts.propertyId,
      schemaName: 'google_pm_extract',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          property_manager_company: { type: ['string', 'null'] },
          confidence_note: { type: ['string', 'null'] },
        },
        required: ['property_manager_company', 'confidence_note'],
      },
      system:
        'From Google search results about a commercial property, extract a likely property management company only if results clearly indicate one. Prefer companies whose snippets mention management of the property/building. Return null if unclear.',
      user: `Query: ${opts.query}\n\nResults:\n${opts.text.slice(0, 12000)}`,
    });
  } catch {
    return { property_manager_company: null };
  }
}

function demoGoogle(property: PropertyRecord): GooglePmResult {
  if ((property.address?.length ?? 0) % 3 === 0) {
    return {
      property_manager_company: 'Horizon CRE Management',
      raw: { demo: true },
      cost: COST.googleSearchPerQuery,
      found: true,
    };
  }
  return { property_manager_company: null, raw: null, cost: COST.googleSearchPerQuery, found: false };
}
