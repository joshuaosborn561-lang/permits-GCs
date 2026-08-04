import { randomUUID } from 'crypto';
import { COST, TARGET_TITLES, config, isLargePmFirm } from '../config.js';
import { getSupabase, hasSupabase } from '../lib/supabase.js';
import { searchContactsViaGoogle } from './googleSearch.js';
import type { ContactRecord, ContactSource } from '../types.js';

export interface CachedContact {
  property_manager_company: string;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  source: ContactSource;
  match_confidence: string | null;
}

export interface EnrichmentResult {
  contact: CachedContact | null;
  cost: number;
  fromCache: boolean;
}

function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(llc|inc|corp|corporation|ltd|lp|llp|co|company|the)\b/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function lookupContactCache(company: string): Promise<CachedContact | null> {
  if (!hasSupabase()) return null;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('pm_company_contact_cache')
    .select('*')
    .eq('company_key', companyKey(company))
    .maybeSingle();
  if (error || !data) return null;
  return {
    property_manager_company: data.property_manager_company,
    contact_name: data.contact_name,
    contact_title: data.contact_title,
    contact_email: data.contact_email,
    contact_phone: data.contact_phone,
    source: 'cache',
    match_confidence: data.match_confidence,
  };
}

export async function upsertContactCache(contact: CachedContact): Promise<void> {
  if (!hasSupabase() || !contact.contact_name) return;
  const sb = getSupabase();
  await sb.from('pm_company_contact_cache').upsert(
    {
      property_manager_company: contact.property_manager_company,
      company_key: companyKey(contact.property_manager_company),
      contact_name: contact.contact_name,
      contact_title: contact.contact_title,
      contact_email: contact.contact_email,
      contact_phone: contact.contact_phone,
      source: contact.source === 'cache' ? 'getleads' : contact.source,
      match_confidence: contact.match_confidence,
      resolved_at: new Date().toISOString(),
    },
    { onConflict: 'company_key' },
  );
}

export async function enrichPmCompany(opts: {
  company: string;
  marketHint?: string | null;
  runId: string;
  runCache: Map<string, CachedContact>;
}): Promise<EnrichmentResult> {
  const key = companyKey(opts.company);
  if (opts.runCache.has(key)) {
    return { contact: opts.runCache.get(key)!, cost: 0, fromCache: true };
  }

  const persistent = await lookupContactCache(opts.company);
  if (persistent) {
    opts.runCache.set(key, persistent);
    return { contact: persistent, cost: 0, fromCache: true };
  }

  let cost = 0;

  // 1. getleads ($0 marginal on unlimited)
  const gl = await searchGetleads(opts.company, opts.marketHint);
  cost += gl.cost;
  if (gl.contact) {
    const contact = { ...gl.contact, property_manager_company: opts.company };
    opts.runCache.set(key, contact);
    await upsertContactCache(contact);
    return { contact, cost, fromCache: false };
  }

  // 2. AI Ark
  const ark = await searchAiArk(opts.company, opts.marketHint);
  cost += ark.cost;
  if (ark.contact) {
    const contact = { ...ark.contact, property_manager_company: opts.company };
    opts.runCache.set(key, contact);
    await upsertContactCache(contact);
    return { contact, cost, fromCache: false };
  }

  // 3. LeadMagic
  const lm = await searchLeadmagic(opts.company);
  cost += lm.cost;
  if (lm.contact) {
    const contact = { ...lm.contact, property_manager_company: opts.company };
    opts.runCache.set(key, contact);
    await upsertContactCache(contact);
    return { contact, cost, fromCache: false };
  }

  // 4. Google soft signal
  const g = await searchContactsViaGoogle({ company: opts.company, runId: opts.runId });
  cost += g.cost;
  if (g.contact_name) {
    const contact: CachedContact = {
      property_manager_company: opts.company,
      contact_name: g.contact_name,
      contact_title: g.contact_title,
      contact_email: null,
      contact_phone: null,
      source: 'google_search',
      match_confidence: 'soft',
    };
    opts.runCache.set(key, contact);
    await upsertContactCache(contact);
    return { contact, cost, fromCache: false };
  }

  return { contact: null, cost, fromCache: false };
}

export function contactToRecord(
  runId: string,
  propertyId: string,
  contact: CachedContact,
): ContactRecord {
  return {
    id: randomUUID(),
    property_id: propertyId,
    run_id: runId,
    property_manager_company: contact.property_manager_company,
    contact_name: contact.contact_name,
    contact_title: contact.contact_title,
    contact_email: contact.contact_email,
    contact_phone: contact.contact_phone,
    source: contact.source,
    match_confidence: contact.match_confidence,
  };
}

async function searchGetleads(
  company: string,
  marketHint?: string | null,
): Promise<{ contact: Omit<CachedContact, 'property_manager_company'> | null; cost: number }> {
  if (config.demoMode) {
    return {
      contact: {
        contact_name: 'Alex Rivera',
        contact_title: 'Regional Property Manager',
        contact_email: 'alex.rivera@example-pm.com',
        contact_phone: null,
        source: 'getleads',
        match_confidence: 'high',
      },
      cost: COST.getleadsPerLookup,
    };
  }

  if (!config.getleadsApiKey) {
    return { contact: null, cost: 0 };
  }

  try {
    const body: Record<string, unknown> = {
      company_name: company,
      titles: [...TARGET_TITLES],
      limit: 5,
    };
    if (isLargePmFirm(company) && marketHint) {
      body.location = marketHint;
    }

    const res = await fetch(`${config.getleadsBaseUrl}/v1/contacts/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.getleadsApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.warn('[getleads] non-OK', res.status, await res.text().catch(() => ''));
      return { contact: null, cost: COST.getleadsPerLookup };
    }

    const data = (await res.json()) as {
      contacts?: Array<{
        name?: string;
        full_name?: string;
        title?: string;
        job_title?: string;
        email?: string;
        phone?: string;
      }>;
      data?: Array<Record<string, unknown>>;
    };

    const list = data.contacts || data.data || [];
    const first = list[0] as Record<string, unknown> | undefined;
    if (!first) return { contact: null, cost: COST.getleadsPerLookup };

    return {
      contact: {
        contact_name: str(first.name) || str(first.full_name) || null,
        contact_title: str(first.title) || str(first.job_title) || null,
        contact_email: str(first.email) || null,
        contact_phone: str(first.phone) || null,
        source: 'getleads',
        match_confidence: 'high',
      },
      cost: COST.getleadsPerLookup,
    };
  } catch (err) {
    console.warn('[getleads] error', err);
    return { contact: null, cost: 0 };
  }
}

async function searchAiArk(
  company: string,
  marketHint?: string | null,
): Promise<{ contact: Omit<CachedContact, 'property_manager_company'> | null; cost: number }> {
  if (!config.aiArkApiKey || config.demoMode) {
    return { contact: null, cost: 0 };
  }

  try {
    const res = await fetch(`${config.aiArkBaseUrl}/v1/people/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.aiArkApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        company_name: company,
        titles: [...TARGET_TITLES],
        location: isLargePmFirm(company) ? marketHint ?? undefined : undefined,
        limit: 5,
      }),
    });

    if (!res.ok) {
      console.warn('[ai_ark] non-OK', res.status);
      return { contact: null, cost: COST.aiArkPerLookup };
    }

    const data = (await res.json()) as {
      results?: Array<Record<string, unknown>>;
      data?: Array<Record<string, unknown>>;
    };
    const first = (data.results || data.data || [])[0];
    if (!first) return { contact: null, cost: COST.aiArkPerLookup };

    return {
      contact: {
        contact_name: str(first.name) || str(first.full_name) || null,
        contact_title: str(first.title) || str(first.job_title) || null,
        contact_email: str(first.email) || str(first.work_email) || null,
        contact_phone: str(first.phone) || null,
        source: 'ai_ark',
        match_confidence: 'medium',
      },
      cost: COST.aiArkPerLookup,
    };
  } catch (err) {
    console.warn('[ai_ark] error', err);
    return { contact: null, cost: 0 };
  }
}

async function searchLeadmagic(
  company: string,
): Promise<{ contact: Omit<CachedContact, 'property_manager_company'> | null; cost: number }> {
  if (!config.leadmagicApiKey || config.demoMode) {
    return { contact: null, cost: 0 };
  }

  try {
    // Role finder: 2 credits / successful match (~$0.05 estimate)
    for (const title of TARGET_TITLES.slice(0, 3)) {
      const res = await fetch('https://api.leadmagic.io/v1/people/role-finder', {
        method: 'POST',
        headers: {
          'X-API-Key': config.leadmagicApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          company_name: company,
          job_title: title,
        }),
      });

      if (!res.ok) continue;
      const data = (await res.json()) as Record<string, unknown>;
      const name = str(data.name) || str(data.full_name);
      if (!name) continue;

      return {
        contact: {
          contact_name: name,
          contact_title: str(data.title) || str(data.job_title) || title,
          contact_email: str(data.email) || str(data.work_email) || null,
          contact_phone: str(data.phone) || null,
          source: 'leadmagic',
          match_confidence: 'medium',
        },
        cost: COST.leadmagicPerLookup,
      };
    }

    return { contact: null, cost: 0 };
  } catch (err) {
    console.warn('[leadmagic] error', err);
    return { contact: null, cost: 0 };
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
