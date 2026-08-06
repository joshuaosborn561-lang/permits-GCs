import { config } from '../config.js';
import { COST } from '../config.js';
import { structuredExtract } from '../lib/openai.js';
import type { OwnerType } from '../types.js';

export interface OwnerParseResult {
  owner_entity_name: string;
  care_of_company: string | null;
  is_likely_self_managed: boolean;
  owner_type: OwnerType;
  cost: number;
}

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    owner_entity_name: { type: 'string' },
    care_of_company: { type: ['string', 'null'] },
    is_likely_self_managed: { type: 'boolean' },
    owner_type: { type: 'string', enum: ['individual', 'company', 'trust', 'unknown'] },
  },
  required: ['owner_entity_name', 'care_of_company', 'is_likely_self_managed', 'owner_type'],
} as const;

export async function parseOwnerMailing(opts: {
  mailingAddress: string;
  ownerNameHint?: string | null;
  runId?: string;
  propertyId?: string;
}): Promise<OwnerParseResult> {
  if (config.demoMode || !config.openaiApiKey) {
    return heuristicOwnerParse(opts.mailingAddress, opts.ownerNameHint);
  }

  try {
    const result = await structuredExtract<{
      owner_entity_name: string;
      care_of_company: string | null;
      is_likely_self_managed: boolean;
      owner_type: OwnerType;
    }>({
      step: 'parse_owner_co',
      runId: opts.runId,
      propertyId: opts.propertyId,
      schemaName: 'owner_mailing_parse',
      schema: schema as unknown as Record<string, unknown>,
      system: `Extract owner and care-of (c/o) company from commercial property mailing address strings.
- owner_entity_name is the owner of record (individual, LLC, trust, etc.).
- care_of_company is the company after c/o, % , or "care of" if present and distinct from the owner.
- If c/o is only a variant/abbreviation of the owner entity, set care_of_company null.
- is_likely_self_managed true when there is no distinct third-party management company on the mailing line.
- Classify owner_type as individual, company, trust, or unknown.`,
      user: JSON.stringify({
        mailing_address: opts.mailingAddress,
        owner_name_hint: opts.ownerNameHint ?? null,
      }),
    });

    return { ...result, cost: COST.openaiParsePerRecord };
  } catch {
    return heuristicOwnerParse(opts.mailingAddress, opts.ownerNameHint);
  }
}

export function heuristicOwnerParse(
  mailing: string,
  ownerHint?: string | null,
): OwnerParseResult {
  const text = mailing || '';
  const coMatch =
    text.match(/\bc\/o\s+([^,\n]+)/i) ||
    text.match(/\bcare of\s+([^,\n]+)/i) ||
    text.match(/%\s*([^,\n]+)/i);

  let care_of_company = coMatch?.[1]?.trim() ?? null;
  const owner_entity_name =
    ownerHint?.trim() ||
    text.split(/\n|,/)[0]?.trim() ||
    'Unknown Owner';

  if (care_of_company && isNameVariant(owner_entity_name, care_of_company)) {
    care_of_company = null;
  }

  const owner_type = classifyOwnerType(owner_entity_name);

  return {
    owner_entity_name,
    care_of_company,
    is_likely_self_managed: !care_of_company,
    owner_type,
    cost: COST.openaiParsePerRecord,
  };
}

export function isNameVariant(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(llc|l\.l\.c\.|inc|corp|corporation|ltd|lp|llp|co|company|the)\b/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyOwnerType(name: string): OwnerType {
  const n = name.toLowerCase();
  if (/\b(trust|trustee|living trust|irrevocable)\b/.test(n)) return 'trust';
  if (/\b(llc|l\.l\.c\.|inc|corp|lp|llp|holdings|partners|properties|management)\b/.test(n)) {
    return 'company';
  }
  if (/^[a-z .'-]+$/i.test(name) && name.trim().split(/\s+/).length <= 4) return 'individual';
  return 'unknown';
}
